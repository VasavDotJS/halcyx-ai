import { reported } from '@/core/monitoring/report';
import type { StorageCleaner } from '@/core/cleaner/cleaner';
import type { GitHub } from '@/core/github/client';
import { slugify, uniqueBranchName } from '@/core/github/push';
import { baseLookup, branchHead } from '@/core/github/repos';
import { budgetToTokens, costOf } from '@/core/providers/effort';
import { clampEffort, findModel, type ModelConfig } from '@/core/providers/modelConfig';
import { adapterFor } from '@/core/providers/registry';
import type { ProviderContext } from '@/core/providers/types';
import { randomId } from '@/core/security/crypto';
import type { Settings } from '@/core/settings/types';
import type {
  AgentEvent,
  AgentTaskHandle,
  AgentTaskRequest,
  Effort,
  ImageInput,
  ModelInfo,
  ProviderId,
  RepoRef,
  TaskStatus,
} from '@/core/types';
import { evaluateBudget, type UsageMeter } from '@/core/usage/meter';
import { pushWorkspace, type PushOptions, type PushOutcome } from '@/core/workspace/pushFlow';
import { HOUR, type WorkspaceStore } from '@/core/workspace/store';
import { TERMINAL } from './timeline';
import type { TaskStore } from './taskStore';

export class BudgetExceededError extends Error {
  constructor() {
    super('Your monthly hard cap has been reached. Raise the budget in Settings › Usage to start new tasks.');
  }
}

export type NotifyKind = 'task_finished' | 'task_failed' | 'needs_approval' | 'workspace_expiring';

export type TaskLogEvent = {
  task_id: string;
  repo: string;
  branch: string | null;
  commit_sha: string | null;
  provider: ProviderId;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  files_count: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'incomplete' | 'pushed' | 'expired' | 'discarded';
  started_at: string;
  finished_at: string | null;
};

export type RunnerDeps = {
  tasks: TaskStore;
  workspaces: WorkspaceStore;
  usage: UsageMeter;
  cleaner: StorageCleaner;
  settings: () => Settings;
  models: () => ModelConfig;
  github: () => Promise<GitHub>;
  /** Read-only, repo-scoped token for the sandbox (null for public repos / local providers). */
  scopedToken: (repo: RepoRef) => Promise<string | null>;
  context: (provider: ProviderId, taskId: string, repoFull: string, baseSha: () => string) => Promise<ProviderContext>;
  notify: (kind: NotifyKind, taskId: string, title: string, body: string) => Promise<void>;
  scheduleExpiryWarning: (workspaceId: string, expiresAt: number, repoFull: string) => Promise<void>;
  report: (row: TaskLogEvent) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export type StartInput = {
  prompt: string;
  images: ImageInput[];
  repo: RepoRef;
  baseBranch: string;
  provider: ProviderId;
  model: string;
  effort: Effort;
  instructions: string;
  groupId?: string | null;
  branchSuffix?: string;
};

type Listener = (taskId: string, events: AgentEvent[]) => void;

const POLL_MS = 8_000;
const MAX_ROUNDS = 400;

/**
 * Orchestrates an agent task end to end: start → stream → approvals/pause → collect changes
 * into an encrypted workspace → review → push → erase. All state is persisted after every
 * step, so the app can be killed at any moment and resume where it left off.
 */
export class TaskRunner {
  private readonly listeners = new Set<Listener>();
  private readonly active = new Map<string, AbortController>();
  private readonly buffers = new Map<string, AgentEvent[]>();
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly d: RunnerDeps) {
    this.sleep = d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = d.now ?? Date.now;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private async emit(taskId: string, events: AgentEvent[]): Promise<void> {
    for (const l of this.listeners) l(taskId, events);
    const buf = this.buffers.get(taskId) ?? [];
    buf.push(...events);
    this.buffers.set(taskId, buf);
    const important = events.some((e) => e.type !== 'text' && e.type !== 'thinking' && e.type !== 'terminal');
    if (important || buf.length >= 50) await this.flush(taskId);
  }

  private async flush(taskId: string): Promise<void> {
    const buf = this.buffers.get(taskId);
    if (!buf?.length) return;
    this.buffers.set(taskId, []);
    await this.d.tasks.appendEvents(taskId, buf);
  }

  private async budgetTokens(model: ModelInfo): Promise<number | null> {
    const s = this.d.settings();
    const state = evaluateBudget(
      { monthlyBudgetUsd: s.monthlyBudgetUsd, alertAtPct: s.budgetAlertPct, hardCap: s.hardCap },
      await this.d.usage.monthSpend(),
    );
    if (state.state === 'capped') throw new BudgetExceededError();
    if (!s.hardCap || state.remainingUsd === null) return null;
    return budgetToTokens(model, state.remainingUsd);
  }

  /** Starts a task. Throws BudgetExceededError when the hard cap is reached. */
  async start(input: StartInput): Promise<string> {
    const cfg = this.d.models();
    const model = findModel(cfg, input.provider, input.model);
    if (!model) throw new Error(`Unknown model ${input.model}`);
    const tokenBudget = await this.budgetTokens(model);
    const gh = await this.d.github();
    const baseSha = await branchHead(gh, `${input.repo.owner}/${input.repo.name}`, input.baseBranch);
    if (!baseSha) throw new Error(`Branch ${input.baseBranch} was not found.`);
    const s = this.d.settings();
    const req: AgentTaskRequest = {
      taskId: randomId(12),
      provider: input.provider,
      prompt: input.prompt,
      images: input.images,
      model: model.id,
      effort: clampEffort(model, input.effort),
      repo: input.repo,
      baseBranch: input.baseBranch,
      baseSha,
      readToken: null,
      instructions: input.instructions,
      approvalMode: s.approvalMode,
      askBeforeCommands: s.askBeforeCommands,
      network: s.agentNetwork,
      tokenBudget,
      resume: null,
      branchSuffix: input.branchSuffix ?? null,
    };
    await this.d.tasks.create(req, input.groupId ?? null);
    void this.run(req.taskId, 'start');
    return req.taskId;
  }

  /** Runs 2–3 agents in parallel on separate branches for side-by-side comparison. */
  async startGroup(
    base: Omit<StartInput, 'provider' | 'model' | 'effort'>,
    variants: { provider: ProviderId; model: string; effort: Effort }[],
  ) {
    const groupId = randomId(8);
    const ids: string[] = [];
    const suffixes = ['a', 'b', 'c'];
    for (const [i, v] of variants.slice(0, 3).entries()) {
      ids.push(await this.start({ ...base, ...v, groupId, branchSuffix: suffixes[i] }));
    }
    return { groupId, taskIds: ids };
  }

  private async contextFor(taskId: string, req: AgentTaskRequest): Promise<ProviderContext> {
    return this.d.context(req.provider, taskId, `${req.repo.owner}/${req.repo.name}`, () => req.baseSha);
  }

  private async loadRequest(taskId: string): Promise<AgentTaskRequest> {
    const stored = await this.d.tasks.request(taskId);
    const adapter = adapterFor(stored.provider);
    const readToken = adapter.hasHostedSandbox && stored.repo.private ? await this.d.scopedToken(stored.repo) : null;
    return { ...stored, readToken };
  }

  private async run(taskId: string, mode: 'start' | 'continue' | 'reattach'): Promise<void> {
    if (this.active.has(taskId)) return;
    const abort = new AbortController();
    this.active.set(taskId, abort);
    let status: TaskStatus = 'running';
    let req: AgentTaskRequest | null = null;
    try {
      req = await this.loadRequest(taskId);
      const adapter = adapterFor(req.provider);
      const model = findModel(this.d.models(), req.provider, req.model);
      // Without a price the hard cap can't be enforced, so an unpriceable model never runs.
      if (!model)
        throw new Error(
          `${req.model} is no longer in the model list, so HALCYX can't track its cost. Start a new task with a current model.`,
        );
      const budget = () => this.budgetTokens(model);
      const ctx = { ...(await this.contextFor(taskId, req)), signal: abort.signal, budget };
      let handle: AgentTaskHandle =
        mode === 'start' ? await adapter.startAgentTask(req, ctx) : ((await this.d.tasks.handle(taskId)) as AgentTaskHandle);
      if (!handle) throw new Error('Task handle missing');
      await this.d.tasks.saveHandle(taskId, handle);
      await this.d.tasks.setStatus(taskId, 'running');
      await this.emit(taskId, [{ type: 'status', status: 'running' }]);

      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        // Re-check the cap before every provider call (follow-ups and reattaches included) and
        // hand the agent only what is left, not the allowance computed when the task started.
        req.tokenBudget = await budget();
        for await (const ev of adapter.streamEvents(handle, req, ctx)) {
          if (ev.type === 'status') status = ev.status;
          if (ev.type === 'meta' && ev.environmentId) {
            await this.d.cleaner.trackSandbox(ev.environmentId, req.provider, `${req.repo.owner}/${req.repo.name}`);
          }
          if (ev.type === 'usage') {
            const cost = costOf(model, ev.inputTokens, ev.outputTokens);
            await this.d.usage.record({
              taskId,
              provider: req.provider,
              model: req.model,
              inputTokens: ev.inputTokens,
              outputTokens: ev.outputTokens,
              costUsd: cost,
            });
            const s = this.d.settings();
            const b = evaluateBudget(
              { monthlyBudgetUsd: s.monthlyBudgetUsd, alertAtPct: s.budgetAlertPct, hardCap: s.hardCap },
              await this.d.usage.monthSpend(),
            );
            if (b.state === 'capped') {
              await adapter.cancel(handle, ctx);
              await this.emit(taskId, [ev, { type: 'status', status: 'failed', detail: 'Monthly hard cap reached' }]);
              status = 'failed';
              await this.d.tasks.setStatus(taskId, 'failed', 'Monthly hard cap reached');
              await this.d.tasks.saveHandle(taskId, handle);
              return;
            }
          }
          await this.emit(taskId, [ev]);
          await this.d.tasks.saveHandle(taskId, handle);
        }
        if (status !== 'running' && status !== 'queued') break;
        await this.flush(taskId);
        await this.sleep(POLL_MS);
        if (abort.signal.aborted) return;
      }
      await this.flush(taskId);
      await this.d.tasks.saveHandle(taskId, handle);
      await this.afterTurn(taskId, req, handle, status, ctx);
    } catch (e) {
      if (abort.signal.aborted) return;
      if (e instanceof BudgetExceededError && req) {
        const h = (await this.d.tasks.handle(taskId).catch(() => null)) as AgentTaskHandle | null;
        if (h) {
          const c = await this.contextFor(taskId, req).catch(() => null);
          if (c)
            await adapterFor(req.provider)
              .cancel(h, c)
              .catch(() => undefined);
        }
      }
      const message = e instanceof BudgetExceededError ? 'Monthly hard cap reached' : (e as Error).message;
      await this.emit(taskId, [
        { type: 'error', message },
        { type: 'status', status: 'failed', detail: message },
      ]);
      await this.d.tasks.setStatus(taskId, 'failed', message);
      await this.d.notify('task_failed', taskId, 'Task failed', message.slice(0, 140));
      if (req) await this.report(taskId, req, 'failed', null, null, 0);
    } finally {
      await this.flush(taskId).catch(() => undefined);
      this.active.delete(taskId);
    }
  }

  private async afterTurn(taskId: string, req: AgentTaskRequest, handle: AgentTaskHandle, status: TaskStatus, ctx: ProviderContext) {
    const repoFull = `${req.repo.owner}/${req.repo.name}`;
    switch (status) {
      case 'completed': {
        await this.collect(taskId, req, handle, ctx);
        await this.d.tasks.setStatus(taskId, 'completed');
        await this.d.notify('task_finished', taskId, 'Ready for review', `${repoFull}: changes are waiting in Review.`);
        await this.report(taskId, req, 'completed', null, null, 0);
        break;
      }
      case 'awaiting_approval':
        await this.d.tasks.setStatus(taskId, 'awaiting_approval');
        await this.d.notify('needs_approval', taskId, 'Approval needed', `${repoFull}: the agent is waiting for you.`);
        break;
      case 'paused':
        await this.d.tasks.setStatus(taskId, 'paused');
        break;
      case 'incomplete':
        await this.d.tasks.setStatus(taskId, 'incomplete', 'Token budget reached');
        await this.d.notify('task_failed', taskId, 'Stopped at budget', `${repoFull}: send "continue" to keep going.`);
        await this.report(taskId, req, 'incomplete', null, null, 0);
        break;
      case 'cancelled':
        await this.d.tasks.setStatus(taskId, 'cancelled');
        await this.report(taskId, req, 'cancelled', null, null, 0);
        break;
      default:
        await this.d.tasks.setStatus(taskId, 'failed');
        await this.d.notify('task_failed', taskId, 'Task failed', `${repoFull}: open the task for details.`);
        await this.report(taskId, req, 'failed', null, null, 0);
    }
  }

  /** Pulls sandbox output into the encrypted workspace (creating it on first completion). */
  private async collect(taskId: string, req: AgentTaskRequest, handle: AgentTaskHandle, ctx: ProviderContext) {
    const adapter = adapterFor(req.provider);
    const repoFull = `${req.repo.owner}/${req.repo.name}`;
    const changes = await adapter.collectChanges(handle, req, ctx);
    const gh = await this.d.github();
    const task = await this.d.tasks.get(taskId);
    let wsId = task?.workspaceId ?? null;
    if (wsId) {
      await this.d.workspaces.updateMeta(wsId, { baseSha: req.baseSha, remoteHeadSha: null, environmentId: handle.environmentId });
    } else {
      const suffix = req.branchSuffix;
      const slug = slugify(req.prompt);
      const branch = await uniqueBranchName(gh, repoFull, `halcyx/${slug}${suffix ? `-${suffix}` : ''}`);
      wsId = await this.d.workspaces.create({
        taskId,
        repoFull,
        provider: req.provider,
        baseBranch: req.baseBranch,
        baseSha: req.baseSha,
        targetBranch: branch,
        environmentId: handle.environmentId,
        retentionMs: this.d.settings().retentionHours * HOUR,
      });
      await this.d.tasks.setWorkspace(taskId, wsId);
      const ws = await this.d.workspaces.get(wsId);
      await this.d.scheduleExpiryWarning(wsId, ws.expiresAt, repoFull);
    }
    await this.d.workspaces.ingest(wsId, changes, await baseLookup(gh, repoFull, req.baseSha));
    await this.d.tasks.clearCheckpoint(taskId);
  }

  async respond(taskId: string, approvalId: string, allow: boolean): Promise<void> {
    const req = await this.loadRequest(taskId);
    const handle = await this.d.tasks.handle(taskId);
    if (!handle) return;
    const ctx = await this.contextFor(taskId, req);
    const next = await adapterFor(req.provider).respondToApproval(handle, approvalId, allow, req, ctx);
    await this.d.tasks.saveHandle(taskId, next);
    await this.emit(taskId, [{ type: 'status', status: 'running', detail: allow ? 'Approved' : 'Denied' }]);
    void this.run(taskId, 'continue');
  }

  async pause(taskId: string): Promise<void> {
    const req = await this.loadRequest(taskId);
    const handle = await this.d.tasks.handle(taskId);
    if (!handle) return;
    await adapterFor(req.provider).pause(handle, await this.contextFor(taskId, req));
    await this.d.tasks.saveHandle(taskId, handle);
    this.active.get(taskId)?.abort();
    this.active.delete(taskId);
    await this.d.tasks.setStatus(taskId, 'paused');
    await this.emit(taskId, [{ type: 'status', status: 'paused' }]);
  }

  async stop(taskId: string): Promise<void> {
    const req = await this.loadRequest(taskId);
    const handle = await this.d.tasks.handle(taskId);
    if (handle) await adapterFor(req.provider).cancel(handle, await this.contextFor(taskId, req));
    this.active.get(taskId)?.abort();
    this.active.delete(taskId);
    await this.d.tasks.setStatus(taskId, 'cancelled');
    await this.emit(taskId, [{ type: 'status', status: 'cancelled' }]);
    await this.report(taskId, req, 'cancelled', null, null, 0);
  }

  /** Continue after pause, or ask for refinements in the same sandbox. */
  async followUp(taskId: string, text: string): Promise<void> {
    const req = await this.loadRequest(taskId);
    const handle = await this.d.tasks.handle(taskId);
    if (!handle) throw new Error('Task cannot be continued');
    const next = await adapterFor(req.provider).sendMessage(handle, text, req, await this.contextFor(taskId, req));
    await this.d.tasks.saveHandle(taskId, next);
    await this.emit(taskId, [{ type: 'text', delta: `\n\n› ${text}\n\n` }]);
    void this.run(taskId, 'continue');
  }

  async resume(taskId: string): Promise<void> {
    await this.followUp(taskId, 'Continue where you left off.');
  }

  /** The target branch moved: ask the agent to rebase onto the new head, then re-diff. */
  async rebase(workspaceId: string): Promise<void> {
    const ws = await this.d.workspaces.get(workspaceId);
    const remote = ws.meta.remoteHeadSha;
    if (!remote) return;
    const stored = await this.d.tasks.request(ws.taskId);
    await this.d.tasks.saveRequest(ws.taskId, { ...stored, baseSha: remote });
    await this.d.workspaces.setStatus(workspaceId, 'syncing');
    await this.followUp(
      ws.taskId,
      [
        `The branch ${ws.meta.targetBranch} moved to ${remote}. Rebase your work onto it:`,
        `cd /workspace/repo && git stash --include-untracked && git fetch origin ${ws.meta.targetBranch} && git checkout --quiet ${remote} && git stash pop`,
        'Resolve any conflicts so both the upstream change and your change are kept, re-run lint/tests,',
        `then repeat the HALCYX handoff steps using base commit ${remote}.`,
      ].join('\n'),
    );
  }

  /** Review → push → erase, then delete the remote sandbox unless the user keeps it. */
  async push(workspaceId: string, opts: PushOptions): Promise<PushOutcome> {
    const ws = await this.d.workspaces.get(workspaceId);
    const req = await this.loadRequest(ws.taskId);
    const gh = await this.d.github();
    const outcome = await pushWorkspace(this.d.workspaces, gh, workspaceId, opts, async (e) => {
      await this.report(ws.taskId, req, 'pushed', e.branch, e.commitSha, e.filesCount);
    });
    if (outcome.kind === 'pushed') await this.disposeRemote(ws.taskId, req, ws.meta.environmentId);
    return outcome;
  }

  async discard(workspaceId: string): Promise<void> {
    const ws = await this.d.workspaces.get(workspaceId);
    const req = await this.loadRequest(ws.taskId);
    await this.d.workspaces.shred(workspaceId, 'discarded');
    await this.disposeRemote(ws.taskId, req, ws.meta.environmentId, true);
    await this.report(ws.taskId, req, 'discarded', null, null, 0);
  }

  private async disposeRemote(taskId: string, req: AgentTaskRequest, environmentId: string | null, force = false) {
    if (this.d.settings().keepSandboxAfterPush && !force) return;
    const handle = await this.d.tasks.handle(taskId);
    if (!handle) return;
    try {
      await adapterFor(req.provider).disposeSandbox(handle, await this.contextFor(taskId, req));
      if (environmentId) await this.d.cleaner.forgetSandbox(environmentId);
    } catch {
      /* best effort: the cleaner lists anything left behind */
    }
  }

  /** On launch / background wake: reattach to tasks that were running when the app closed. */
  async resumeActive(): Promise<void> {
    for (const t of await this.d.tasks.active()) {
      if (t.status === 'awaiting_approval') continue;
      void this.run(t.id, 'reattach');
    }
  }

  /** Background-task entry point: one non-streaming status check per active task. */
  async pollOnce(): Promise<void> {
    for (const t of await this.d.tasks.active()) {
      if (this.active.has(t.id) || t.status === 'awaiting_approval') continue;
      const req = await this.loadRequest(t.id);
      const handle = await this.d.tasks.handle(t.id);
      if (!handle) continue;
      const ctx = await this.contextFor(t.id, req);
      const events = await adapterFor(req.provider).pollStatus(handle, ctx);
      const last = [...events].reverse().find((e): e is Extract<AgentEvent, { type: 'status' }> => e.type === 'status');
      if (last && TERMINAL.includes(last.status)) {
        await this.emit(t.id, events);
        await this.afterTurn(t.id, req, handle, last.status, ctx);
      }
    }
  }

  isRunning(taskId: string): boolean {
    return this.active.has(taskId);
  }

  private async report(
    taskId: string,
    req: AgentTaskRequest,
    status: TaskLogEvent['status'],
    branch: string | null,
    commitSha: string | null,
    filesCount: number,
  ) {
    const t = await this.d.tasks.get(taskId);
    await this.d
      .report({
        task_id: taskId,
        repo: `${req.repo.owner}/${req.repo.name}`,
        branch,
        commit_sha: commitSha,
        provider: req.provider,
        model: req.model,
        input_tokens: t?.inputTokens ?? 0,
        output_tokens: t?.outputTokens ?? 0,
        cost_usd: Math.round((t?.costUsd ?? 0) * 10_000) / 10_000,
        files_count: filesCount,
        status,
        started_at: new Date(t?.createdAt ?? this.now()).toISOString(),
        finished_at: TERMINAL.includes(status as TaskStatus) || status === 'pushed' ? new Date(this.now()).toISOString() : null,
      })
      .catch(reported('task.report'));
  }
}

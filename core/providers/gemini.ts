import { toBase64, utf8 } from '@/core/security/crypto';
import type { AgentEvent, AgentTaskRequest, KeyValidation, StepKind } from '@/core/types';
import { mapEffort, GEMINI_AGENT_BUDGET } from './effort';
import { APPROVAL_TOOL, agentRules, buildChangeSet, decodeOrNull, findPreviewUrl, REPO_DIR } from './handoff';
import { type FetchLike, ProviderError, request, requestBytes, requestJson, streamBody } from './http';
import { BUNDLED_MODEL_CONFIG } from './modelConfig';
import { sseJson } from './sse';
import type { ProviderAdapter, ProviderContext } from './types';
import { remoteCleanCommand } from '@/core/cleaner/patterns';

/**
 * Google Antigravity managed agent via the Gemini Interactions API.
 * Docs: ai.google.dev/gemini-api/docs/antigravity-agent, /agent-environment, /streaming.
 */
const API = 'https://generativelanguage.googleapis.com/v1beta';
const OUT_DIR = '/workspace/.halcyx';
const ENV_OUT = 'workspace/.halcyx';

const headers = (key: string) => ({ 'x-goog-api-key': key, 'content-type': 'application/json' });

type Step = { type: string; id?: string; name?: string; arguments?: unknown; call_id?: string };
type GeminiEvent = {
  event_type: string;
  interaction?: { id: string; status?: string; environment_id?: string; usage?: Usage };
  interaction_id?: string;
  status?: string;
  index?: number;
  step?: Step;
  delta?: Record<string, unknown> & { type: string };
  usage?: Usage;
  error?: { message?: string };
};
type Usage = { total_input_tokens?: number; total_output_tokens?: number; total_thought_tokens?: number };

function agentId(): string {
  return BUNDLED_MODEL_CONFIG.agents.gemini;
}

function environmentFor(req: AgentTaskRequest) {
  const network = req.readToken
    ? {
        allowlist: [
          { domain: 'github.com', transform: { Authorization: `Basic ${toBase64(utf8.encode(`x-oauth-basic:${req.readToken}`))}` } },
          { domain: '*' },
        ],
      }
    : undefined;
  return {
    type: 'remote',
    sources: [
      { type: 'repository', source: `https://github.com/${req.repo.owner}/${req.repo.name}`, target: REPO_DIR },
      { type: 'inline', target: '.agents/AGENTS.md', content: agentRules(req, OUT_DIR) },
    ],
    ...(network ? { network } : {}),
  };
}

function agentConfig(req: AgentTaskRequest) {
  const base = mapEffort('gemini', req.model, req.effort).agent_config as Record<string, unknown>;
  const budget = base.max_total_tokens as number;
  return { ...base, max_total_tokens: req.tokenBudget ? Math.min(budget, req.tokenBudget) : budget };
}

function tools(req: AgentTaskRequest) {
  if (!req.approvalMode && !req.askBeforeCommands) return undefined;
  return [{ type: 'code_execution' }, { type: 'google_search' }, { type: 'url_context' }, { type: 'function', ...APPROVAL_TOOL }];
}

function stepKind(type: string, name?: string): StepKind {
  if (type.startsWith('code_execution')) return 'command';
  if (type.startsWith('google_search') || type.startsWith('url_context')) return 'search';
  if (name && /write|edit|create|replace|delete|move|file/i.test(name)) return 'file';
  return 'tool';
}

function pathFromArgs(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null;
  const a = args as Record<string, unknown>;
  const p = a.path ?? a.file_path ?? a.TargetFile ?? a.target_file ?? a.filename;
  return typeof p === 'string' ? p.replace(`${REPO_DIR}/`, '') : null;
}

function mapStatus(s: string | undefined): AgentEvent {
  switch (s) {
    case 'completed':
      return { type: 'status', status: 'completed' };
    case 'requires_action':
      return { type: 'status', status: 'awaiting_approval' };
    case 'incomplete':
      return { type: 'status', status: 'incomplete', detail: 'Token budget reached' };
    case 'cancelled':
      return { type: 'status', status: 'cancelled' };
    case 'failed':
      return { type: 'status', status: 'failed' };
    default:
      return { type: 'status', status: 'running' };
  }
}

async function downloadFile(ctx: ProviderContext, envId: string, path: string): Promise<Uint8Array | null> {
  try {
    return await requestBytes(ctx.fetch, `${API}/environments/${envId}/files/${path}?alt=media`, {
      headers: { 'x-goog-api-key': ctx.apiKey },
      signal: ctx.signal,
    });
  } catch (e) {
    if (e instanceof ProviderError && e.status === 404) return null;
    throw e;
  }
}

async function createInteraction(ctx: ProviderContext, body: Record<string, unknown>) {
  return requestJson<{ id: string; environment_id?: string; status?: string }>(ctx.fetch, `${API}/interactions`, {
    method: 'POST',
    headers: headers(ctx.apiKey),
    body: JSON.stringify({ agent: agentId(), background: true, ...body }),
    signal: ctx.signal,
  });
}

export const geminiAdapter: ProviderAdapter = {
  id: 'gemini',
  label: 'Google Gemini · Antigravity',
  hasHostedSandbox: true,
  approvalEnforcement: 'instructed',
  keyHelpUrl: 'https://aistudio.google.com/apikey',

  listModels: (cfg) => cfg.providers.gemini,

  async validateKey({ apiKey, fetch }): Promise<KeyValidation> {
    try {
      await request(fetch as FetchLike, `${API}/models?pageSize=1`, { headers: { 'x-goog-api-key': apiKey } });
      return { status: 'valid', checkedAt: Date.now() };
    } catch (e) {
      const kind = e instanceof ProviderError ? e.kind : 'network_error';
      const status = kind === 'invalid' || kind === 'quota_exceeded' || kind === 'network_error' ? kind : 'invalid';
      return { status, checkedAt: Date.now(), message: (e as Error).message };
    }
  },

  mapEffort: (model, effort) => mapEffort('gemini', model, effort),

  async startAgentTask(req, ctx) {
    const input: unknown[] = [{ type: 'text', text: req.prompt }];
    for (const img of req.images) input.push({ type: 'image', data: img.base64, mime_type: img.mimeType });
    // Streamed creation happens in streamEvents; here we only record the request shape.
    return {
      provider: 'gemini',
      taskId: req.taskId,
      remoteId: '',
      environmentId: req.resume?.environmentId ?? null,
      model: req.model,
      state: { pendingInput: input, previousId: req.resume?.remoteId ?? null },
    };
  },

  async *streamEvents(handle, req, ctx) {
    const pending = handle.state.pendingInput as unknown[] | undefined;
    if (!pending) {
      yield* await geminiAdapter.pollStatus(handle, ctx);
      return;
    }
    const body: Record<string, unknown> = {
      agent: agentId(),
      input: pending,
      stream: true,
      background: true,
      agent_config: agentConfig(req),
      environment: handle.environmentId
        ? req.readToken
          ? { type: 'remote', environment_id: handle.environmentId, network: environmentFor(req).network }
          : handle.environmentId
        : environmentFor(req),
    };
    if (handle.state.previousId) body.previous_interaction_id = handle.state.previousId;
    const t = tools(req);
    if (t) body.tools = t;

    const res = await request(ctx.fetch, `${API}/interactions`, {
      method: 'POST',
      headers: { ...headers(ctx.apiKey), accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal: ctx.signal,
    });
    delete handle.state.pendingInput;

    const steps = new Map<number, { id: string; type: string; name?: string; args: string; callId: string | null }>();
    let usageIn = 0;
    let usageOut = 0;
    const emitUsage = function* (u?: Usage): Generator<AgentEvent> {
      if (!u) return;
      const inT = u.total_input_tokens ?? 0;
      const outT = (u.total_output_tokens ?? 0) + (u.total_thought_tokens ?? 0);
      if (inT > usageIn || outT > usageOut) {
        yield { type: 'usage', inputTokens: Math.max(0, inT - usageIn), outputTokens: Math.max(0, outT - usageOut) };
        usageIn = Math.max(usageIn, inT);
        usageOut = Math.max(usageOut, outT);
      }
    };

    for await (const ev of sseJson<GeminiEvent>(streamBody(res))) {
      switch (ev.event_type) {
        case 'interaction.created': {
          handle.remoteId = ev.interaction!.id;
          if (ev.interaction?.environment_id) handle.environmentId = ev.interaction.environment_id;
          yield { type: 'meta', remoteId: handle.remoteId, environmentId: handle.environmentId ?? undefined };
          yield { type: 'status', status: 'running' };
          break;
        }
        case 'step.start': {
          const s = ev.step!;
          const idx = ev.index ?? steps.size;
          const id = `${handle.remoteId}:${idx}`;
          steps.set(idx, { id, type: s.type, name: s.name, args: '', callId: s.id ?? null });
          if (s.type === 'model_output' || s.type === 'thought') break;
          if (s.type === 'function_call' && s.name === APPROVAL_TOOL.name) break;
          if (s.type.endsWith('_result') || s.type === 'function_result') break;
          yield { type: 'step', id, kind: stepKind(s.type, s.name), title: s.name ?? s.type.replace(/_/g, ' '), state: 'started' };
          break;
        }
        case 'step.delta': {
          const d = ev.delta!;
          const st = steps.get(ev.index ?? -1);
          if (d.type === 'text') {
            const text = String(d.text ?? '');
            yield { type: 'text', delta: text };
            const url = findPreviewUrl(text);
            if (url) yield { type: 'preview_url', url };
          } else if (d.type === 'thought_summary') {
            const c = d.content as { text?: string } | undefined;
            if (c?.text) yield { type: 'thinking', delta: c.text };
          } else if (d.type === 'arguments_delta' && st) {
            st.args += String(d.arguments ?? '');
          } else if (st) {
            const args = d.arguments as Record<string, unknown> | undefined;
            const chunk = args?.code ?? args?.command ?? d.output ?? d.result ?? d.stdout ?? d.stderr;
            if (typeof chunk === 'string' && chunk) {
              yield { type: 'terminal', stepId: st.id, chunk };
              const url = findPreviewUrl(chunk);
              if (url) yield { type: 'preview_url', url };
            }
          }
          break;
        }
        case 'step.stop': {
          const st = steps.get(ev.index ?? -1);
          if (st?.type === 'function_call') {
            let args: Record<string, unknown> = {};
            try {
              args = st.args ? (JSON.parse(st.args) as Record<string, unknown>) : {};
            } catch {
              args = {};
            }
            if (st.name === APPROVAL_TOOL.name) {
              const callId = st.callId ?? st.id;
              handle.state.pendingApproval = { callId, name: st.name };
              yield {
                type: 'approval',
                approvalId: callId,
                title: String(args.action ?? 'Approve action'),
                detail: [args.command, args.reason].filter(Boolean).join('\n'),
              };
            } else {
              const path = pathFromArgs(args);
              if (path) yield { type: 'file_change', path, change: /delete|remove/i.test(st.name ?? '') ? 'deleted' : 'modified' };
              yield {
                type: 'step',
                id: st.id,
                kind: stepKind(st.type, st.name),
                title: path ? `${st.name} ${path}` : (st.name ?? 'tool'),
                state: 'done',
              };
            }
          } else if (st && st.type !== 'model_output' && st.type !== 'thought' && !st.type.endsWith('_result')) {
            yield {
              type: 'step',
              id: st.id,
              kind: stepKind(st.type, st.name),
              title: st.name ?? st.type.replace(/_/g, ' '),
              state: 'done',
            };
          }
          yield* emitUsage(ev.usage);
          break;
        }
        case 'interaction.status_update':
          yield mapStatus(ev.status);
          break;
        case 'interaction.completed':
          yield* emitUsage(ev.interaction?.usage);
          if (ev.interaction?.environment_id) handle.environmentId = ev.interaction.environment_id;
          yield { type: 'meta', remoteId: handle.remoteId, environmentId: handle.environmentId ?? undefined };
          yield mapStatus(ev.interaction?.status);
          break;
        case 'error':
          yield { type: 'error', message: ev.error?.message ?? 'Agent error' };
          yield { type: 'status', status: 'failed', detail: ev.error?.message };
          break;
        default:
          break; // Unknown events are skipped per the API's versioning guidance.
      }
    }
  },

  async sendMessage(handle, text, _req, _ctx) {
    return {
      ...handle,
      state: { ...handle.state, pendingInput: [{ type: 'text', text }], previousId: handle.remoteId },
    };
  },

  async respondToApproval(handle, approvalId, allow) {
    const pending = handle.state.pendingApproval as { callId: string; name: string } | undefined;
    const callId = pending?.callId ?? approvalId;
    return {
      ...handle,
      state: {
        ...handle.state,
        pendingApproval: undefined,
        previousId: handle.remoteId,
        pendingInput: [
          {
            type: 'function_result',
            name: APPROVAL_TOOL.name,
            call_id: callId,
            result: { approved: allow, note: allow ? 'Approved by the user.' : 'Denied by the user. Do not perform it.' },
          },
        ],
      },
    };
  },

  async pause(handle, ctx) {
    await geminiAdapter.cancel(handle, ctx);
  },

  async cancel(handle, ctx) {
    if (!handle.remoteId) return;
    await request(ctx.fetch, `${API}/interactions/${handle.remoteId}:cancel`, {
      method: 'POST',
      headers: { 'x-goog-api-key': ctx.apiKey },
    }).catch(() => undefined);
  },

  async pollStatus(handle, ctx) {
    if (!handle.remoteId) return [];
    const it = await requestJson<{ status?: string; environment_id?: string; usage?: Usage }>(
      ctx.fetch,
      `${API}/interactions/${handle.remoteId}`,
      { headers: { 'x-goog-api-key': ctx.apiKey }, signal: ctx.signal },
    );
    if (it.environment_id) handle.environmentId = it.environment_id;
    return [mapStatus(it.status)];
  },

  async collectChanges(handle, req, ctx) {
    if (!handle.environmentId) throw new ProviderError('The sandbox environment is unknown', 0, 'server');
    const env = handle.environmentId;
    const [tar, deleted, summary, checks] = await Promise.all([
      downloadFile(ctx, env, `${ENV_OUT}/changes.tar`),
      downloadFile(ctx, env, `${ENV_OUT}/deleted.txt`),
      downloadFile(ctx, env, `${ENV_OUT}/summary.md`),
      downloadFile(ctx, env, `${ENV_OUT}/checks.json`),
    ]);
    return buildChangeSet({
      tar,
      deleted: decodeOrNull(deleted),
      summary: decodeOrNull(summary),
      checks: decodeOrNull(checks),
      title: req.prompt.slice(0, 60),
    });
  },

  async disposeSandbox(handle, ctx) {
    if (!handle.environmentId) return;
    await request(ctx.fetch, `${API}/environments/${handle.environmentId}`, {
      method: 'DELETE',
      headers: { 'x-goog-api-key': ctx.apiKey },
    }).catch((e) => {
      if (!(e instanceof ProviderError && e.status === 404)) throw e;
    });
  },

  async scanSandbox(environmentId, ctx) {
    const res = await requestJson<{ files?: { path: string; type: string; size_bytes?: string }[] }>(
      ctx.fetch,
      `${API}/environments/${environmentId}/files/workspace?recursive=true`,
      { headers: { 'x-goog-api-key': ctx.apiKey }, signal: ctx.signal },
    );
    return (res.files ?? [])
      .filter((f) => f.type === 'FILE')
      .map((f) => ({ path: f.path.replace(/^workspace\/repo\//, ''), bytes: Number(f.size_bytes ?? 0) }));
  },

  async cleanSandbox(environmentId, paths, ctx) {
    if (!paths.length) return;
    await createInteraction(ctx, {
      background: false,
      environment: environmentId,
      agent_config: { type: 'antigravity', model: 'gemini-3.5-flash-lite', max_total_tokens: GEMINI_AGENT_BUDGET.low },
      tools: [{ type: 'code_execution' }],
      input: `Run exactly this command and nothing else, then reply "done": ${remoteCleanCommand(REPO_DIR, paths)}`,
    });
  },
};

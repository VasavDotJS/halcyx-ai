import type { AgentEvent, AgentTaskRequest, KeyValidation } from '@/core/types';
import { mapEffort } from './effort';
import { APPROVAL_TOOL, agentRules, buildChangeSet, decodeOrNull, findPreviewUrl, REPO_DIR } from './handoff';
import { type FetchLike, ProviderError, request, requestBytes, requestJson, streamBody } from './http';
import { sseJson } from './sse';
import type { ProviderAdapter, ProviderContext } from './types';
import { remoteCleanCommand } from '@/core/cleaner/patterns';

/**
 * Claude Managed Agents (beta `managed-agents-2026-04-01`): agent + cloud environment +
 * session with the repo mounted as a `github_repository` resource. Approval mode uses the
 * runtime permission policy (`always_ask`), so commands are blocked until the user answers.
 */
const API = 'https://api.anthropic.com/v1';
const OUT_DIR = '/mnt/session/outputs/halcyx';
const BETA = 'managed-agents-2026-04-01';
const FILES_BETA = 'files-api-2025-04-14';

function headers(ctx: Pick<ProviderContext, 'apiKey' | 'isWeb'>, beta = BETA): Record<string, string> {
  return {
    'x-api-key': ctx.apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': beta,
    'content-type': 'application/json',
    ...(ctx.isWeb ? { 'anthropic-dangerous-direct-browser-access': 'true' } : {}),
  };
}

const post = <T>(ctx: ProviderContext, path: string, body: unknown) =>
  requestJson<T>(ctx.fetch, `${API}${path}`, { method: 'POST', headers: headers(ctx), body: JSON.stringify(body), signal: ctx.signal });

async function ensureAgent(req: AgentTaskRequest, ctx: ProviderContext): Promise<string> {
  const policy = req.askBeforeCommands ? 'always_ask' : 'always_allow';
  const cacheKey = `anthropic.agent.v1.${policy}.${req.approvalMode ? 'approve' : 'auto'}`;
  const cached = await ctx.cache.get(cacheKey);
  if (cached) return cached;
  const agent = await post<{ id: string }>(ctx, '/agents', {
    name: 'HALCYX Coding Agent',
    description: 'Coding agent operated from the HALCYX mobile app.',
    model: { id: req.model, effort: req.effort },
    system:
      'You are a careful coding agent. Follow the task instructions in each message exactly, especially the handoff steps at the end.',
    tools: [
      { type: 'agent_toolset_20260401', default_config: { permission_policy: { type: policy } } },
      {
        type: 'custom',
        name: APPROVAL_TOOL.name,
        description: APPROVAL_TOOL.description,
        input_schema: APPROVAL_TOOL.parameters,
      },
    ],
    metadata: { app: 'halcyx' },
  });
  await ctx.cache.set(cacheKey, agent.id);
  return agent.id;
}

async function ensureEnvironment(ctx: ProviderContext): Promise<string> {
  const cached = await ctx.cache.get('anthropic.environment.v1');
  if (cached) return cached;
  const env = await post<{ id: string }>(ctx, '/environments', {
    name: 'halcyx-cloud',
    config: { type: 'cloud', networking: { type: 'unrestricted' } },
  });
  await ctx.cache.set('anthropic.environment.v1', env.id);
  return env.id;
}

function userMessage(text: string, images: AgentTaskRequest['images'] = []) {
  return {
    type: 'user.message',
    content: [
      { type: 'text', text },
      ...images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mimeType, data: i.base64 } })),
    ],
  };
}

type MaEvent = {
  id?: string;
  type: string;
  content?: { type: string; text?: string; thinking?: string }[];
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
  evaluated_permission?: string;
  stop_reason?: { type: string; event_ids?: string[] };
  error?: { message?: string };
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
};

function textOf(content: MaEvent['content']): string {
  return (content ?? []).map((c) => c.text ?? c.thinking ?? '').join('');
}

async function download(ctx: ProviderContext, fileId: string): Promise<Uint8Array> {
  return requestBytes(ctx.fetch, `${API}/files/${fileId}/content`, {
    headers: headers(ctx, `${BETA},${FILES_BETA}`),
    signal: ctx.signal,
  });
}

export const anthropicAdapter: ProviderAdapter = {
  id: 'anthropic',
  label: 'Anthropic Claude · Managed Agents',
  hasHostedSandbox: true,
  approvalEnforcement: 'runtime',
  keyHelpUrl: 'https://platform.claude.com/settings/keys',

  listModels: (cfg) => cfg.providers.anthropic,

  async validateKey(ctx): Promise<KeyValidation> {
    try {
      await request(ctx.fetch as FetchLike, `${API}/models?limit=1`, { headers: headers(ctx, '') });
      return { status: 'valid', checkedAt: Date.now() };
    } catch (e) {
      const kind = e instanceof ProviderError ? e.kind : 'network_error';
      const status = kind === 'invalid' || kind === 'quota_exceeded' || kind === 'network_error' ? kind : 'invalid';
      return { status, checkedAt: Date.now(), message: (e as Error).message };
    }
  },

  mapEffort: (model, effort) => mapEffort('anthropic', model, effort),

  async startAgentTask(req, ctx) {
    if (req.resume) {
      return {
        provider: 'anthropic',
        taskId: req.taskId,
        remoteId: req.resume.remoteId,
        environmentId: req.resume.remoteId,
        model: req.model,
        state: { pendingEvents: [userMessage(req.prompt, req.images)] },
      };
    }
    const [agentId, environmentId] = await Promise.all([ensureAgent(req, ctx), ensureEnvironment(ctx)]);
    const session = await post<{ id: string }>(ctx, '/sessions', {
      agent: { type: 'agent_with_overrides', id: agentId, model: { id: req.model, effort: req.effort } },
      environment_id: environmentId,
      title: req.prompt.slice(0, 80),
      resources: [
        {
          type: 'github_repository',
          url: `https://github.com/${req.repo.owner}/${req.repo.name}`,
          mount_path: REPO_DIR,
          checkout: { type: 'branch', name: req.baseBranch },
          ...(req.readToken ? { authorization_token: req.readToken } : {}),
        },
      ],
    });
    const prompt = `${agentRules(req, OUT_DIR)}\n\nTask:\n${req.prompt}`;
    return {
      provider: 'anthropic',
      taskId: req.taskId,
      remoteId: session.id,
      environmentId: session.id,
      model: req.model,
      state: { pendingEvents: [userMessage(prompt, req.images)] },
    };
  },

  async *streamEvents(handle, _req, ctx) {
    const res = await request(ctx.fetch, `${API}/sessions/${handle.remoteId}/events/stream`, {
      headers: { ...headers(ctx), accept: 'text/event-stream' },
      signal: ctx.signal,
    });
    const pending = (handle.state.pendingEvents as unknown[] | undefined) ?? [];
    if (pending.length) {
      await post(ctx, `/sessions/${handle.remoteId}/events`, { events: pending });
      handle.state.pendingEvents = [];
    }
    yield { type: 'meta', remoteId: handle.remoteId, environmentId: handle.remoteId };

    const toolNames = new Map<string, string>();
    const approvals = new Map<string, AgentEvent>();
    for await (const ev of sseJson<MaEvent>(streamBody(res))) {
      if (ev.usage && (ev.usage.input_tokens || ev.usage.output_tokens)) {
        yield { type: 'usage', inputTokens: ev.usage.input_tokens ?? 0, outputTokens: ev.usage.output_tokens ?? 0 };
      }
      switch (ev.type) {
        case 'session.status_running':
          yield { type: 'status', status: 'running' };
          break;
        case 'agent.message': {
          const text = textOf(ev.content);
          yield { type: 'text', delta: text };
          const url = findPreviewUrl(text);
          if (url) yield { type: 'preview_url', url };
          break;
        }
        case 'agent.thinking':
          yield { type: 'thinking', delta: textOf(ev.content) };
          break;
        case 'agent.tool_use':
        case 'agent.mcp_tool_use': {
          const id = ev.id ?? String(toolNames.size);
          const name = ev.name ?? 'tool';
          toolNames.set(id, name);
          const input = ev.input ?? {};
          const path = typeof input.file_path === 'string' ? input.file_path : typeof input.path === 'string' ? input.path : null;
          const command = typeof input.command === 'string' ? input.command : null;
          const kind = name === 'bash' ? 'command' : path ? 'file' : /search|fetch/.test(name) ? 'search' : 'tool';
          yield {
            type: 'step',
            id,
            kind,
            title: command ?? (path ? `${name} ${path.replace(`${REPO_DIR}/`, '')}` : name),
            state: 'started',
          };
          if (path && /write|edit/.test(name)) yield { type: 'file_change', path: path.replace(`${REPO_DIR}/`, ''), change: 'modified' };
          if (ev.evaluated_permission === 'ask') {
            approvals.set(id, {
              type: 'approval',
              approvalId: `confirm:${id}`,
              title: `Allow ${name}?`,
              detail: command ?? path ?? JSON.stringify(input).slice(0, 400),
            });
          }
          break;
        }
        case 'agent.custom_tool_use': {
          if (ev.name === APPROVAL_TOOL.name && ev.id) {
            const i = ev.input ?? {};
            approvals.set(ev.id, {
              type: 'approval',
              approvalId: `custom:${ev.id}`,
              title: String(i.action ?? 'Approve action'),
              detail: [i.command, i.reason].filter(Boolean).join('\n'),
            });
          }
          break;
        }
        case 'agent.tool_result':
        case 'agent.mcp_tool_result': {
          const id = ev.tool_use_id ?? '';
          const chunk = textOf(ev.content);
          if (chunk) {
            yield { type: 'terminal', stepId: id, chunk };
            const url = findPreviewUrl(chunk);
            if (url) yield { type: 'preview_url', url };
          }
          yield {
            type: 'step',
            id,
            kind: toolNames.get(id) === 'bash' ? 'command' : 'tool',
            title: toolNames.get(id) ?? 'tool',
            state: ev.is_error ? 'error' : 'done',
          };
          break;
        }
        case 'session.status_idle': {
          const reason = ev.stop_reason?.type;
          if (reason === 'requires_action') {
            for (const eid of ev.stop_reason?.event_ids ?? []) {
              const a = approvals.get(eid) ?? { type: 'approval', approvalId: `confirm:${eid}`, title: 'Allow tool call?', detail: '' };
              yield a;
            }
            yield { type: 'status', status: 'awaiting_approval' };
          } else if (reason === 'budget_reached') {
            yield { type: 'status', status: 'incomplete', detail: 'Session budget reached' };
          } else {
            yield { type: 'status', status: handle.state.paused ? 'paused' : 'completed' };
          }
          return;
        }
        case 'session.error':
          yield { type: 'error', message: ev.error?.message ?? 'Session error' };
          yield { type: 'status', status: 'failed', detail: ev.error?.message };
          return;
        default:
          break;
      }
    }
  },

  async sendMessage(handle, text) {
    return { ...handle, state: { ...handle.state, paused: false, pendingEvents: [userMessage(text)] } };
  },

  async respondToApproval(handle, approvalId, allow) {
    const [kind, id] = approvalId.split(':') as ['confirm' | 'custom', string];
    const event =
      kind === 'custom'
        ? {
            type: 'user.custom_tool_result',
            custom_tool_use_id: id,
            content: [{ type: 'text', text: allow ? 'Approved by the user.' : 'Denied by the user. Do not perform it.' }],
          }
        : { type: 'user.tool_confirmation', tool_use_id: id, result: allow ? 'allow' : 'deny' };
    const queued = (handle.state.pendingEvents as unknown[] | undefined) ?? [];
    return { ...handle, state: { ...handle.state, pendingEvents: [...queued, event] } };
  },

  async pause(handle, ctx) {
    handle.state.paused = true;
    await post(ctx, `/sessions/${handle.remoteId}/events`, { events: [{ type: 'user.interrupt' }] });
  },

  async cancel(handle, ctx) {
    await post(ctx, `/sessions/${handle.remoteId}/events`, { events: [{ type: 'user.interrupt' }] }).catch(() => undefined);
  },

  async pollStatus(handle, ctx) {
    const s = await requestJson<{ status?: string }>(ctx.fetch, `${API}/sessions/${handle.remoteId}`, {
      headers: headers(ctx),
      signal: ctx.signal,
    });
    if (s.status === 'running' || s.status === 'rescheduling') return [{ type: 'status', status: 'running' }];
    if (s.status === 'terminated') return [{ type: 'status', status: 'failed', detail: 'Session terminated' }];
    return [{ type: 'status', status: 'completed' }];
  },

  async collectChanges(handle, req, ctx) {
    const list = await requestJson<{ data: { id: string; filename: string }[] }>(
      ctx.fetch,
      `${API}/files?scope_id=${encodeURIComponent(handle.remoteId)}&limit=100`,
      { headers: headers(ctx, `${BETA},${FILES_BETA}`), signal: ctx.signal },
    );
    const byName = (name: string) => list.data.find((f) => f.filename === name || f.filename.endsWith(`/${name}`));
    const fetchNamed = async (name: string) => {
      const f = byName(name);
      return f ? download(ctx, f.id) : null;
    };
    const [tar, deleted, summary, checks] = await Promise.all([
      fetchNamed('changes.tar'),
      fetchNamed('deleted.txt'),
      fetchNamed('summary.md'),
      fetchNamed('checks.json'),
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
    await request(ctx.fetch, `${API}/sessions/${handle.remoteId}`, { method: 'DELETE', headers: headers(ctx) }).catch((e) => {
      if (!(e instanceof ProviderError && e.status === 404)) throw e;
    });
  },

  async cleanSandbox(sessionId, paths, ctx) {
    if (!paths.length) return;
    await post(ctx, `/sessions/${sessionId}/events`, {
      events: [userMessage(`Housekeeping only. Run exactly this command and nothing else: ${remoteCleanCommand(REPO_DIR, paths)}`)],
    });
  },
};

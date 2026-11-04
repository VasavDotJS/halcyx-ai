import { fromBase64, toBase64, utf8 } from '@/core/security/crypto';
import type { AgentEvent, AgentTaskRequest, ChangeSet, KeyValidation } from '@/core/types';
import { isBinary } from '@/core/workspace/diff';
import { mapEffort } from './effort';
import { APPROVAL_TOOL, parseSummary, safeRepoPath } from './handoff';
import { type FetchLike, ProviderError, request, streamBody } from './http';
import { sseJson } from './sse';
import type { ProviderAdapter, ProviderContext } from './types';

/**
 * OpenAI has no hosted sandbox here, so HALCYX falls back to plain tool-calling chat
 * (Responses API, `store: false`). The model edits an in-memory overlay of the repository
 * through file tools executed on device; nothing is executed. State is checkpointed
 * (encrypted) after every tool call so the loop survives app restarts.
 */
const API = 'https://api.openai.com/v1';
const MAX_TURNS = 40;
const MAX_READ = 200_000;

type Item = Record<string, unknown> & { type: string };
type Checkpoint = {
  input: Item[];
  files: Record<string, string>; // path → base64 (new content)
  deleted: string[];
  finish: { summary: string; commitMessage: string } | null;
  pendingApproval: { callId: string } | null;
  turns: number;
};

const fnTool = (name: string, description: string, properties: Record<string, unknown>, required: string[]) => ({
  type: 'function',
  name,
  description,
  parameters: { type: 'object', properties, required, additionalProperties: false },
  strict: true,
});

const TOOLS = [
  fnTool('list_files', 'List repository file paths, optionally under a directory prefix.', { prefix: { type: 'string' } }, ['prefix']),
  fnTool('read_file', 'Read a UTF-8 text file from the repository (with your pending edits applied).', { path: { type: 'string' } }, [
    'path',
  ]),
  fnTool('write_file', 'Create or overwrite a file with the full new content.', { path: { type: 'string' }, content: { type: 'string' } }, [
    'path',
    'content',
  ]),
  fnTool('delete_file', 'Delete a file.', { path: { type: 'string' } }, ['path']),
  fnTool(
    'finish',
    'Call once when the task is complete.',
    { commit_message: { type: 'string', description: 'Conventional Commit, max 72 chars' }, summary: { type: 'string' } },
    ['commit_message', 'summary'],
  ),
  { type: 'function', name: APPROVAL_TOOL.name, description: APPROVAL_TOOL.description, parameters: APPROVAL_TOOL.parameters },
];

function instructions(req: AgentTaskRequest): string {
  return [
    `You are a coding agent operated from the HALCYX mobile app, editing ${req.repo.owner}/${req.repo.name} at ${req.baseSha.slice(0, 7)} (${req.baseBranch}).`,
    'You cannot run commands. Use list_files and read_file to understand the code, then write_file / delete_file to change it.',
    'Write complete file contents. Never add secrets or .env files. Keep changes minimal and focused.',
    req.approvalMode ? 'Call request_approval before deleting files or writing database migrations.' : '',
    'When done, call finish with a Conventional Commit message and a short Markdown summary.',
    req.instructions.trim() ? `Project instructions:\n${req.instructions.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function loadCheckpoint(ctx: ProviderContext): Promise<Checkpoint | null> {
  const raw = await ctx.checkpoint.load();
  return raw ? (JSON.parse(raw) as Checkpoint) : null;
}

async function runTool(cp: Checkpoint, ctx: ProviderContext, name: string, args: Record<string, string>): Promise<string> {
  const path = args.path !== undefined ? safeRepoPath(args.path) : null;
  switch (name) {
    case 'list_files': {
      const all = new Set([...(await ctx.repo.list()), ...Object.keys(cp.files)]);
      for (const d of cp.deleted) all.delete(d);
      const prefix = (args.prefix ?? '').replace(/^\/+/, '');
      return (
        [...all]
          .filter((p) => p.startsWith(prefix))
          .sort()
          .slice(0, 2000)
          .join('\n') || '(no files)'
      );
    }
    case 'read_file': {
      if (!path) return 'Error: invalid path';
      if (cp.deleted.includes(path)) return 'Error: file was deleted';
      const bytes = cp.files[path] ? fromBase64(cp.files[path]!) : await ctx.repo.read(path);
      if (!bytes) return 'Error: file not found';
      if (isBinary(bytes)) return 'Error: binary file';
      return utf8.decode(bytes.slice(0, MAX_READ));
    }
    case 'write_file': {
      if (!path) return 'Error: invalid path';
      cp.files[path] = toBase64(utf8.encode(args.content ?? ''));
      cp.deleted = cp.deleted.filter((d) => d !== path);
      return `Wrote ${path}`;
    }
    case 'delete_file': {
      if (!path) return 'Error: invalid path';
      delete cp.files[path];
      if (!cp.deleted.includes(path)) cp.deleted.push(path);
      return `Deleted ${path}`;
    }
    case 'finish':
      cp.finish = { summary: args.summary ?? '', commitMessage: args.commit_message ?? '' };
      return 'Recorded.';
    default:
      return `Error: unknown tool ${name}`;
  }
}

type RespEvent = {
  type: string;
  delta?: string;
  item?: Item;
  response?: { output?: Item[]; usage?: { input_tokens?: number; output_tokens?: number }; error?: { message?: string } };
  message?: string;
};

export const openaiAdapter: ProviderAdapter = {
  id: 'openai',
  label: 'OpenAI · tool-calling',
  hasHostedSandbox: false,
  approvalEnforcement: 'local',
  keyHelpUrl: 'https://platform.openai.com/api-keys',

  listModels: (cfg) => cfg.providers.openai,

  async validateKey({ apiKey, fetch }): Promise<KeyValidation> {
    try {
      await request(fetch as FetchLike, `${API}/models`, { headers: { authorization: `Bearer ${apiKey}` } });
      return { status: 'valid', checkedAt: Date.now() };
    } catch (e) {
      const kind = e instanceof ProviderError ? e.kind : 'network_error';
      const status = kind === 'invalid' || kind === 'quota_exceeded' || kind === 'network_error' ? kind : 'invalid';
      return { status, checkedAt: Date.now(), message: (e as Error).message };
    }
  },

  mapEffort: (model, effort) => mapEffort('openai', model, effort),

  async startAgentTask(req, ctx) {
    const existing = await loadCheckpoint(ctx);
    if (!existing) {
      const content: Item[] = [{ type: 'input_text', text: req.prompt }];
      for (const img of req.images) content.push({ type: 'input_image', image_url: `data:${img.mimeType};base64,${img.base64}` });
      const cp: Checkpoint = {
        input: [{ type: 'message', role: 'user', content }],
        files: {},
        deleted: [],
        finish: null,
        pendingApproval: null,
        turns: 0,
      };
      await ctx.checkpoint.save(JSON.stringify(cp));
    }
    return { provider: 'openai', taskId: req.taskId, remoteId: `local:${req.taskId}`, environmentId: null, model: req.model, state: {} };
  },

  async *streamEvents(handle, req, ctx): AsyncGenerator<AgentEvent> {
    const cp = await loadCheckpoint(ctx);
    if (!cp) throw new ProviderError('Task checkpoint missing', 0, 'server');
    yield { type: 'status', status: 'running' };

    while (!cp.finish && cp.turns < MAX_TURNS) {
      if (cp.pendingApproval) {
        yield { type: 'status', status: 'awaiting_approval' };
        return;
      }
      if (handle.state.paused) {
        yield { type: 'status', status: 'paused' };
        return;
      }
      cp.turns += 1;
      // Hard cap: checked before every call (throws when reached); output is limited to what's left.
      const remaining = ctx.budget ? await ctx.budget() : req.tokenBudget;
      const res = await request(ctx.fetch, `${API}/responses`, {
        method: 'POST',
        headers: { authorization: `Bearer ${ctx.apiKey}`, 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({
          model: req.model,
          ...mapEffort('openai', req.model, req.effort),
          instructions: instructions(req),
          input: cp.input,
          tools: TOOLS,
          stream: true,
          store: false,
          include: ['reasoning.encrypted_content'],
          ...(remaining !== null ? { max_output_tokens: Math.max(256, Math.min(remaining, 128_000)) } : {}),
        }),
        signal: ctx.signal,
      });

      let output: Item[] = [];
      for await (const ev of sseJson<RespEvent>(streamBody(res))) {
        if (ev.type === 'response.output_text.delta' && ev.delta) yield { type: 'text', delta: ev.delta };
        else if (ev.type === 'response.reasoning_summary_text.delta' && ev.delta) yield { type: 'thinking', delta: ev.delta };
        else if (ev.type === 'response.completed' || ev.type === 'response.incomplete') {
          output = ev.response?.output ?? [];
          const u = ev.response?.usage;
          if (u) yield { type: 'usage', inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0 };
          if (ev.type === 'response.incomplete') {
            cp.input.push(...output);
            await ctx.checkpoint.save(JSON.stringify(cp));
            yield { type: 'status', status: 'incomplete', detail: 'Output limit reached' };
            return;
          }
        } else if (ev.type === 'response.failed' || ev.type === 'error') {
          const message = ev.response?.error?.message ?? ev.message ?? 'Model error';
          yield { type: 'error', message };
          yield { type: 'status', status: 'failed', detail: message };
          return;
        }
      }

      cp.input.push(...output);
      const calls = output.filter((i) => i.type === 'function_call');
      if (!calls.length) break;
      for (const call of calls) {
        const name = String(call.name);
        const callId = String(call.call_id);
        let args: Record<string, string> = {};
        try {
          args = JSON.parse(String(call.arguments ?? '{}')) as Record<string, string>;
        } catch {
          args = {};
        }
        if (name === APPROVAL_TOOL.name) {
          cp.pendingApproval = { callId };
          await ctx.checkpoint.save(JSON.stringify(cp));
          yield {
            type: 'approval',
            approvalId: callId,
            title: args.action ?? 'Approve action',
            detail: [args.command, args.reason].filter(Boolean).join('\n'),
          };
          yield { type: 'status', status: 'awaiting_approval' };
          return;
        }
        const stepId = `${callId}`;
        const title = args.path ? `${name} ${args.path}` : name;
        yield { type: 'step', id: stepId, kind: name.endsWith('_file') && name !== 'read_file' ? 'file' : 'tool', title, state: 'started' };
        const result = await runTool(cp, ctx, name, args);
        if ((name === 'write_file' || name === 'delete_file') && args.path) {
          yield { type: 'file_change', path: args.path, change: name === 'delete_file' ? 'deleted' : 'modified' };
        }
        cp.input.push({ type: 'function_call_output', call_id: callId, output: result.slice(0, MAX_READ) });
        yield { type: 'step', id: stepId, kind: 'tool', title, state: result.startsWith('Error') ? 'error' : 'done' };
      }
      await ctx.checkpoint.save(JSON.stringify(cp));
    }
    await ctx.checkpoint.save(JSON.stringify(cp));
    yield { type: 'status', status: 'completed' };
  },

  async sendMessage(handle, text, _req, ctx) {
    const cp = await loadCheckpoint(ctx);
    if (cp) {
      cp.input.push({ type: 'message', role: 'user', content: [{ type: 'input_text', text }] });
      cp.finish = null;
      await ctx.checkpoint.save(JSON.stringify(cp));
    }
    return { ...handle, state: { ...handle.state, paused: false } };
  },

  async respondToApproval(handle, approvalId, allow, _req, ctx) {
    const cp = await loadCheckpoint(ctx);
    if (cp?.pendingApproval?.callId === approvalId) {
      cp.input.push({
        type: 'function_call_output',
        call_id: approvalId,
        output: JSON.stringify({ approved: allow, note: allow ? 'Approved by the user.' : 'Denied. Do not do it.' }),
      });
      cp.pendingApproval = null;
      await ctx.checkpoint.save(JSON.stringify(cp));
    }
    return handle;
  },

  async pause(handle) {
    handle.state.paused = true;
  },

  async cancel(handle) {
    handle.state.paused = true;
  },

  async pollStatus(_handle, ctx) {
    const cp = await loadCheckpoint(ctx);
    if (!cp) return [{ type: 'status', status: 'failed', detail: 'Checkpoint missing' }];
    if (cp.pendingApproval) return [{ type: 'status', status: 'awaiting_approval' }];
    return [{ type: 'status', status: cp.finish ? 'completed' : 'paused' }];
  },

  async collectChanges(_handle, req, ctx): Promise<ChangeSet> {
    const cp = await loadCheckpoint(ctx);
    if (!cp) throw new ProviderError('Task checkpoint missing', 0, 'server');
    const { commitMessage, summary } = parseSummary(
      cp.finish ? `${cp.finish.commitMessage}\n\n${cp.finish.summary}` : null,
      req.prompt.slice(0, 60),
    );
    return {
      files: Object.entries(cp.files).map(([path, b64]) => ({ path, bytes: fromBase64(b64) })),
      deleted: cp.deleted,
      commitMessage,
      summary,
      checks: {
        lint: { status: 'not_run', summary: 'No hosted sandbox for this provider' },
        tests: { status: 'not_run', summary: 'No hosted sandbox for this provider' },
      },
    };
  },

  async disposeSandbox() {
    /* Nothing remote to delete: store:false keeps no server-side state. */
  },
};

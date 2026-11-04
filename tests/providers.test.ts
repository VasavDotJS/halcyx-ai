import { buildTimeline } from '@/core/agent/timeline';
import { estimate, mapEffort } from '@/core/providers/effort';
import { buildChangeSet, handoffCommand, safeRepoPath } from '@/core/providers/handoff';
import { BUNDLED_MODEL_CONFIG, clampEffort, defaultModel, findModel, parseModelConfig } from '@/core/providers/modelConfig';
import { geminiAdapter } from '@/core/providers/gemini';
import { anthropicAdapter } from '@/core/providers/anthropic';
import { openaiAdapter } from '@/core/providers/openai';
import type { ProviderContext } from '@/core/providers/types';
import { utf8 } from '@/core/security/crypto';
import type { AgentEvent, AgentTaskRequest } from '@/core/types';
import { writeTar } from '@/core/workspace/tar';

function sse(events: unknown[]): Response {
  const body = events
    .map((e) => `event: ${(e as { event_type?: string }).event_type ?? 'message'}\ndata: ${JSON.stringify(e)}\n\n`)
    .join('');
  const bytes = utf8.encode(body);
  return new Response(
    new ReadableStream({
      start(c) {
        // split into awkward chunks to exercise the parser
        for (let i = 0; i < bytes.length; i += 17) c.enqueue(bytes.slice(i, i + 17));
        c.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

const req: AgentTaskRequest = {
  taskId: 't1',
  provider: 'gemini',
  prompt: 'Add a dark mode toggle',
  images: [],
  model: 'gemini-4-argon',
  effort: 'high',
  repo: { owner: 'octo', name: 'demo', id: 1, defaultBranch: 'main', private: true },
  baseBranch: 'main',
  baseSha: 'b'.repeat(40),
  readToken: 'ghs_scopedreadonly',
  instructions: 'Use pnpm.',
  approvalMode: true,
  askBeforeCommands: false,
  tokenBudget: 1_000_000,
  resume: null,
  branchSuffix: null,
};

function ctx(fetchImpl: ProviderContext['fetch'], extra: Partial<ProviderContext> = {}): ProviderContext {
  const cache = new Map<string, string>();
  let cp: string | null = null;
  return {
    apiKey: 'test-key',
    fetch: fetchImpl,
    isWeb: false,
    cache: { get: async (k) => cache.get(k) ?? null, set: async (k, v) => void cache.set(k, v) },
    checkpoint: { load: async () => cp, save: async (j) => void (cp = j) },
    repo: { list: async () => ['src/a.ts'], read: async () => utf8.encode('export const a = 1;\n') },
    models: BUNDLED_MODEL_CONFIG,
    ...extra,
  };
}

async function collect(it: AsyncIterable<AgentEvent>) {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('model config & effort', () => {
  it('ships verified Gemini model IDs', () => {
    expect(findModel(BUNDLED_MODEL_CONFIG, 'gemini', 'gemini-4-argon')).not.toBeNull();
    expect(findModel(BUNDLED_MODEL_CONFIG, 'gemini', 'gemini-3.8-flash')).not.toBeNull();
    expect(BUNDLED_MODEL_CONFIG.agents.gemini).toBe('antigravity-preview-09-2026');
    expect(defaultModel(BUNDLED_MODEL_CONFIG, 'gemini').id).toBe('gemini-3.8-flash');
  });

  it('falls back to bundled lists when remote config is malformed', () => {
    const cfg = parseModelConfig({ providers: { gemini: [{ id: 'BAD ID' }], openai: [] } });
    expect(cfg.providers.gemini).toEqual(BUNDLED_MODEL_CONFIG.providers.gemini);
    expect(cfg.providers.openai).toEqual(BUNDLED_MODEL_CONFIG.providers.openai);
  });

  it('maps effort to each provider’s native parameter', () => {
    expect(mapEffort('gemini', 'gemini-4-argon', 'high')).toEqual({
      agent_config: { type: 'antigravity', model: 'gemini-4-argon', max_total_tokens: 4_000_000 },
    });
    expect(mapEffort('gemini', 'gemini-3.8-flash', 'low', 'chat')).toEqual({ generation_config: { thinking_level: 'low' } });
    expect(mapEffort('anthropic', 'claude-opus-5-5', 'max')).toEqual({ model: { id: 'claude-opus-5-5', effort: 'max' } });
    expect(mapEffort('openai', 'gpt-6.1-sol', 'medium')).toEqual({ reasoning: { effort: 'medium', summary: 'auto' } });
  });

  it('clamps unsupported effort and estimates cost/speed monotonically', () => {
    const argon = findModel(BUNDLED_MODEL_CONFIG, 'gemini', 'gemini-4-argon')!;
    expect(clampEffort(argon, 'max')).toBe('high');
    const low = estimate(argon, 'low');
    const high = estimate(argon, 'high');
    expect(high.usd).toBeGreaterThan(low.usd);
    expect(['Fastest', 'Fast', 'Moderate', 'Slow', 'Slowest'].indexOf(high.speed)).toBeGreaterThanOrEqual(
      ['Fastest', 'Fast', 'Moderate', 'Slow', 'Slowest'].indexOf(low.speed),
    );
  });
});

describe('handoff contract', () => {
  it('rejects paths escaping the repo', () => {
    expect(safeRepoPath('../etc/passwd')).toBeNull();
    expect(safeRepoPath('.git/config')).toBeNull();
    expect(safeRepoPath('./src/a.ts')).toBe('src/a.ts');
  });

  it('builds a change set from the sandbox archive', () => {
    const cs = buildChangeSet({
      tar: writeTar([
        { path: 'src/a.ts', bytes: utf8.encode('x') },
        { path: '../evil', bytes: utf8.encode('x') },
      ]),
      deleted: 'old.txt\0../nope\0',
      summary: 'feat: dark mode\n\nAdds a toggle.',
      checks: '{"lint":{"status":"passed","summary":"0 problems"},"tests":{"status":"failed","summary":"1 failing"}}',
      title: 't',
    });
    expect(cs.files.map((f) => f.path)).toEqual(['src/a.ts']);
    expect(cs.deleted).toEqual(['old.txt']);
    expect(cs.commitMessage).toBe('feat: dark mode');
    expect(cs.checks.tests.status).toBe('failed');
  });

  it('quotes the handoff command safely', () => {
    expect(handoffCommand('a'.repeat(40), "/out/it's")).toContain("'/out/it'\\''s/changes.tar'");
  });
});

describe('Gemini Antigravity adapter', () => {
  it('sends the documented request shape and maps the SSE stream', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetchImpl = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
      return sse([
        { event_type: 'interaction.created', interaction: { id: 'v1_abc', status: 'in_progress' } },
        { event_type: 'step.start', index: 0, step: { type: 'code_execution_call', id: 'c1' } },
        { event_type: 'step.delta', index: 0, delta: { type: 'code_execution_call', arguments: { code: 'pnpm test' } } },
        { event_type: 'step.stop', index: 0, usage: { total_input_tokens: 1000, total_output_tokens: 100 } },
        { event_type: 'step.start', index: 1, step: { type: 'model_output' } },
        { event_type: 'step.delta', index: 1, delta: { type: 'text', text: 'Done. HALCYX_PREVIEW_URL=https://preview.example.dev' } },
        { event_type: 'step.stop', index: 1, usage: { total_input_tokens: 1500, total_output_tokens: 160 } },
        {
          event_type: 'interaction.completed',
          interaction: {
            id: 'v1_abc',
            status: 'completed',
            environment_id: 'env_1',
            usage: { total_input_tokens: 1500, total_output_tokens: 160 },
          },
        },
      ]);
    });
    const c = ctx(fetchImpl as unknown as ProviderContext['fetch']);
    const handle = await geminiAdapter.startAgentTask(req, c);
    const events = await collect(geminiAdapter.streamEvents(handle, req, c));

    const body = calls[0]!.body;
    expect(calls[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(body.agent).toBe('antigravity-preview-09-2026');
    expect(body.agent_config).toEqual({ type: 'antigravity', model: 'gemini-4-argon', max_total_tokens: 1_000_000 });
    expect(body.stream).toBe(true);
    const env = body.environment as { sources: { type: string; source?: string }[]; network: { allowlist: { domain: string }[] } };
    expect(env.sources[0]).toMatchObject({ type: 'repository', source: 'https://github.com/octo/demo' });
    expect(env.network.allowlist[0]!.domain).toBe('github.com');
    expect((body.tools as { name?: string }[]).some((t) => t.name === 'request_approval')).toBe(true);

    const t = buildTimeline(events);
    expect(t.status).toBe('completed');
    expect(t.steps[0]!.output).toBe('pnpm test');
    expect(t.previewUrl).toBe('https://preview.example.dev');
    expect(t.inputTokens).toBe(1500);
    expect(t.outputTokens).toBe(160);
    expect(handle.environmentId).toBe('env_1');
  });

  it('surfaces approvals and answers with a function_result', async () => {
    const fetchImpl = jest.fn(async () =>
      sse([
        { event_type: 'interaction.created', interaction: { id: 'v1_x', status: 'in_progress' } },
        { event_type: 'step.start', index: 0, step: { type: 'function_call', id: 'call_9', name: 'request_approval', arguments: {} } },
        {
          event_type: 'step.delta',
          index: 0,
          delta: { type: 'arguments_delta', arguments: '{"action":"Delete build/","command":"rm -rf build"}' },
        },
        { event_type: 'step.stop', index: 0 },
        { event_type: 'interaction.completed', interaction: { id: 'v1_x', status: 'requires_action', environment_id: 'env_2' } },
      ]),
    );
    const c = ctx(fetchImpl as unknown as ProviderContext['fetch']);
    const handle = await geminiAdapter.startAgentTask(req, c);
    const t = buildTimeline(await collect(geminiAdapter.streamEvents(handle, req, c)));
    expect(t.status).toBe('awaiting_approval');
    expect(t.approvals[0]).toMatchObject({ approvalId: 'call_9', title: 'Delete build/' });

    const next = await geminiAdapter.respondToApproval(handle, 'call_9', false, req, c);
    expect(next.state.previousId).toBe('v1_x');
    expect((next.state.pendingInput as unknown[])[0]).toMatchObject({
      type: 'function_result',
      call_id: 'call_9',
      result: { approved: false },
    });
  });

  it('classifies key validation errors', async () => {
    const bad = await geminiAdapter.validateKey({
      apiKey: 'x',
      isWeb: false,
      fetch: (async () =>
        json(
          { error: { message: 'API key not valid', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } },
          400,
        )) as never,
    });
    expect(bad.status).toBe('invalid');
    const quota = await geminiAdapter.validateKey({ apiKey: 'x', isWeb: false, fetch: (async () => json({}, 429)) as never });
    expect(quota.status).toBe('quota_exceeded');
  });
});

describe('Anthropic Managed Agents adapter', () => {
  it('creates agent, environment and session with a read-only repo mount', async () => {
    const posted: { url: string; body: Record<string, unknown> }[] = [];
    const fetchImpl = jest.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') posted.push({ url, body: JSON.parse(String(init.body)) });
      if (url.endsWith('/agents')) return json({ id: 'agent_1' });
      if (url.endsWith('/environments')) return json({ id: 'env_1' });
      if (url.endsWith('/sessions')) return json({ id: 'sesn_1' });
      if (url.endsWith('/events/stream'))
        return sse([
          { type: 'session.status_running' },
          { type: 'agent.tool_use', id: 'tu_1', name: 'bash', input: { command: 'npm test' }, evaluated_permission: 'ask' },
          { type: 'session.status_idle', stop_reason: { type: 'requires_action', event_ids: ['tu_1'] } },
        ]);
      return json({});
    });
    const r = { ...req, provider: 'anthropic' as const, model: 'claude-opus-5-5', askBeforeCommands: true };
    const c = ctx(fetchImpl as unknown as ProviderContext['fetch']);
    const handle = await anthropicAdapter.startAgentTask(r, c);
    const t = buildTimeline(await collect(anthropicAdapter.streamEvents(handle, r, c)));

    const agent = posted.find((p) => p.url.endsWith('/agents'))!.body;
    expect((agent.tools as { default_config?: { permission_policy: { type: string } } }[])[0]!.default_config!.permission_policy.type).toBe(
      'always_ask',
    );
    const session = posted.find((p) => p.url.endsWith('/sessions'))!.body;
    expect(session.agent).toEqual({ type: 'agent_with_overrides', id: 'agent_1', model: { id: 'claude-opus-5-5', effort: 'high' } });
    expect((session.resources as Record<string, unknown>[])[0]).toMatchObject({
      type: 'github_repository',
      url: 'https://github.com/octo/demo',
      authorization_token: 'ghs_scopedreadonly',
    });
    expect(t.status).toBe('awaiting_approval');
    expect(t.approvals[0]!.approvalId).toBe('confirm:tu_1');
  });
});

describe('OpenAI tool-calling fallback', () => {
  it('edits an on-device overlay and never executes anything', async () => {
    let turn = 0;
    const fetchImpl = jest.fn(async () => {
      turn += 1;
      const output =
        turn === 1
          ? [
              {
                type: 'function_call',
                call_id: 'f1',
                name: 'write_file',
                arguments: JSON.stringify({ path: 'src/a.ts', content: 'export const a = 2;\n' }),
              },
            ]
          : [
              {
                type: 'function_call',
                call_id: 'f2',
                name: 'finish',
                arguments: JSON.stringify({ commit_message: 'fix: bump a', summary: 'Sets a to 2' }),
              },
            ];
      return sse([
        { type: 'response.output_text.delta', delta: turn === 1 ? 'Editing…' : '' },
        { type: 'response.completed', response: { output, usage: { input_tokens: 100, output_tokens: 20 } } },
      ]);
    });
    const r = { ...req, provider: 'openai' as const, model: 'gpt-6.1-sol' };
    const c = ctx(fetchImpl as unknown as ProviderContext['fetch']);
    const handle = await openaiAdapter.startAgentTask(r, c);
    const t = buildTimeline(await collect(openaiAdapter.streamEvents(handle, r, c)));
    expect(t.status).toBe('completed');
    expect(t.files.get('src/a.ts')).toBe('modified');
    const cs = await openaiAdapter.collectChanges(handle, r, c);
    expect(utf8.decode(cs.files[0]!.bytes)).toBe('export const a = 2;\n');
    expect(cs.commitMessage).toBe('fix: bump a');
    expect(cs.checks.tests.status).toBe('not_run');
  });
});

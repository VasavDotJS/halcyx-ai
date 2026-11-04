import { BudgetExceededError } from '@/core/agent/runner';
import { networkingFor } from '@/core/providers/anthropic';
import { networkFor, PACKAGE_REGISTRY_HOSTS } from '@/core/providers/gemini';
import { agentRules, buildChangeSet, handoffCommand, OUTPUT_LIMITS } from '@/core/providers/handoff';
import { ProviderError, requestBytes } from '@/core/providers/http';
import { BUNDLED_MODEL_CONFIG } from '@/core/providers/modelConfig';
import { openaiAdapter } from '@/core/providers/openai';
import type { ProviderContext } from '@/core/providers/types';
import { utf8 } from '@/core/security/crypto';
import type { AgentTaskRequest } from '@/core/types';
import { preflight, SCAN_FILE_LIMIT } from '@/core/workspace/preflight';
import { readTarLimited, TarLimitError, writeTar } from '@/core/workspace/tar';

const req: AgentTaskRequest = {
  taskId: 't1',
  provider: 'gemini',
  prompt: 'Fix the bug',
  images: [],
  model: 'gemini-3.8-flash',
  effort: 'medium',
  repo: { owner: 'acme', name: 'app', defaultBranch: 'main', private: true, id: 1 },
  baseBranch: 'main',
  baseSha: 'b'.repeat(40),
  readToken: 'ghs_scopedreadonly',
  instructions: '',
  approvalMode: true,
  askBeforeCommands: false,
  tokenBudget: null,
  resume: null,
  branchSuffix: null,
};

const NO_CHECKS = { lint: { status: 'not_run' as const, summary: '' }, tests: { status: 'not_run' as const, summary: '' } };

describe('H-2: sandbox output is bounded', () => {
  it('refuses archives with too many entries', () => {
    const tar = writeTar([...Array(5)].map((_, i) => ({ path: `f${i}.txt`, bytes: utf8.encode('x') })));
    expect(() => readTarLimited(tar, { maxEntries: 4, maxEntryBytes: 1000 })).toThrow(TarLimitError);
  });

  it('skips oversized files instead of loading them, and reports them', () => {
    const tar = writeTar([
      { path: 'small.txt', bytes: utf8.encode('ok') },
      { path: 'huge.bin', bytes: new Uint8Array(4096) },
    ]);
    const r = readTarLimited(tar, { maxEntries: 10, maxEntryBytes: 1024 });
    expect(r.entries.map((e) => e.path)).toEqual(['small.txt']);
    expect(r.skipped).toEqual([{ path: 'huge.bin', bytes: 4096 }]);
  });

  it('surfaces skipped files in the change set', () => {
    const cs = buildChangeSet({
      tar: writeTar([{ path: 'a.txt', bytes: utf8.encode('a') }]),
      deleted: null,
      summary: null,
      checks: null,
      title: 't',
    });
    expect(cs.skipped).toEqual([]);
    expect(OUTPUT_LIMITS.archiveBytes).toBeLessThanOrEqual(50 * 1024 * 1024);
  });

  it('rejects downloads over the cap by Content-Length without reading them', async () => {
    const res = new Response('x', { headers: { 'content-length': String(60 * 1024 * 1024) } });
    await expect(requestBytes(async () => res, 'https://x', {}, 50 * 1024 * 1024)).rejects.toBeInstanceOf(ProviderError);
  });

  it('stops streaming downloads that exceed the cap', async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled += 1;
        c.enqueue(new Uint8Array(1024));
        if (pulled > 100) c.close();
      },
    });
    await expect(requestBytes(async () => new Response(body), 'https://x', {}, 4096)).rejects.toThrow(/more than/);
    expect(pulled).toBeLessThan(20);
  });

  it('returns bodies under the cap intact', async () => {
    const out = await requestBytes(async () => new Response('hello'), 'https://x', {}, 1024);
    expect(utf8.decode(out)).toBe('hello');
  });

  it('blocks push when files are too large to scan for secrets, unless overridden', () => {
    const big = new Uint8Array(SCAN_FILE_LIMIT + 1).fill(97);
    const files = [{ path: 'big.txt', bytes: big, change: 'added' as const, mode: '100644' }];
    const p = preflight(files as never, NO_CHECKS);
    expect(p.unscanned).toEqual([{ path: 'big.txt', bytes: big.length }]);
    expect(p.blocked).toBe(true);
    expect(p.overridable).toBe(true);
    expect(preflight(files as never, NO_CHECKS, true).blocked).toBe(false);
  });
});

describe('H-3: sandbox egress is default-deny', () => {
  it('Gemini allows registries + github.com only, with the token header scoped to github.com', () => {
    const n = networkFor(req);
    const domains = n.allowlist.map((e) => e.domain);
    expect(domains).not.toContain('*');
    expect(domains[0]).toBe('github.com');
    expect(domains).toEqual(['github.com', ...PACKAGE_REGISTRY_HOSTS]);
    expect(n.allowlist.filter((e) => 'transform' in e)).toHaveLength(1);
  });

  it('Gemini opens up only on explicit opt-in', () => {
    expect(networkFor({ ...req, network: 'open' }).allowlist.map((e) => e.domain)).toEqual(['github.com', '*']);
  });

  it('Anthropic uses limited networking unless the user opts in', () => {
    expect(networkingFor({})).toEqual({ type: 'limited', allowed_hosts: [], allow_package_managers: true, allow_mcp_servers: false });
    expect(networkingFor({ network: 'open' })).toEqual({ type: 'unrestricted' });
  });
});

describe('M-9: values placed in sandbox commands are validated', () => {
  it('rejects a non-SHA base and unsafe branch names', () => {
    expect(() => handoffCommand('HEAD; curl evil', '/out')).toThrow(/SHA/);
    expect(() => agentRules({ ...req, baseBranch: 'main; rm -rf /' }, '/out')).toThrow(/branch/);
    expect(() => agentRules({ ...req, baseBranch: '--upload-pack=x' }, '/out')).toThrow(/branch/);
    expect(agentRules(req, '/out')).toContain(`git checkout --quiet '${'b'.repeat(40)}'`);
  });
});

describe('H-5: the hard cap is checked before every model call', () => {
  function ctx(fetchImpl: ProviderContext['fetch'], budget: () => Promise<number | null>): ProviderContext {
    let cp: string | null = null;
    return {
      apiKey: 'k',
      fetch: fetchImpl,
      isWeb: false,
      cache: { get: async () => null, set: async () => undefined },
      checkpoint: { load: async () => cp, save: async (j) => void (cp = j) },
      repo: { list: async () => [], read: async () => null },
      models: BUNDLED_MODEL_CONFIG,
      budget,
    };
  }
  const sse = (events: unknown[]) => new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''));
  const r = { ...req, provider: 'openai' as const, model: 'gpt-6.1-sol', tokenBudget: 1_000_000 };

  it('limits each response to the remaining budget, not the start-time allowance', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return sse([{ type: 'response.completed', response: { output: [], usage: { input_tokens: 1, output_tokens: 1 } } }]);
    }) as ProviderContext['fetch'];
    const c = ctx(fetchImpl, async () => 5_000);
    const handle = await openaiAdapter.startAgentTask(r, c);
    for await (const _ of openaiAdapter.streamEvents(handle, r, c)) void _;
    expect(bodies[0]!.max_output_tokens).toBe(5_000);
  });

  it('makes no call once the cap is reached', async () => {
    const fetchImpl = jest.fn();
    const c = ctx(fetchImpl as unknown as ProviderContext['fetch'], async () => {
      throw new BudgetExceededError();
    });
    const handle = await openaiAdapter.startAgentTask(r, c);
    const run = async () => {
      for await (const _ of openaiAdapter.streamEvents(handle, r, c)) void _;
    };
    await expect(run()).rejects.toBeInstanceOf(BudgetExceededError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

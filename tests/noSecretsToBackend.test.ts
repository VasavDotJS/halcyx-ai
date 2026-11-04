import { assertMetadataOnly, MetadataViolation } from '@/core/backend/metadata';
import { scrubString, scrubValue } from '@/core/security/scrub';

const GOOGLE_KEY = 'AIzaSyD4kq9Lr7Hc2Vbn5Xw1Pq8Zt6Ym3Ja0Ks9';
const SOURCE = 'export function handler(req) {\n  const db = connect();\n  return db.query("select * from users");\n}\n'.repeat(5);

const okTaskLog = {
  task_id: 'a1b2c3',
  repo: 'octo/demo',
  branch: 'halcyx/add-login',
  commit_sha: 'a'.repeat(40),
  provider: 'gemini',
  model: 'gemini-4-argon',
  input_tokens: 1200,
  output_tokens: 300,
  cost_usd: 0.0123,
  files_count: 3,
  status: 'pushed',
  started_at: '2026-11-02T10:00:00.000Z',
  finished_at: '2026-11-02T10:05:00.000Z',
};

describe('backend receives metadata only', () => {
  it('accepts a valid task log row', () => {
    expect(() => assertMetadataOnly('task_log', okTaskLog)).not.toThrow();
  });

  it.each([
    ['an API key in an otherwise valid id field', { ...okTaskLog, task_id: GOOGLE_KEY }],
    ['a prompt/title field', { ...okTaskLog, title: 'Fix the login bug' }],
    ['file content', { ...okTaskLog, content: SOURCE }],
    ['a diff', { ...okTaskLog, diff: '+const a = 1' }],
    ['a key smuggled into the branch name', { ...okTaskLog, branch: `halcyx/${GOOGLE_KEY}` }],
    ['source code in the repo field', { ...okTaskLog, repo: SOURCE }],
  ])('rejects %s', (_label, row) => {
    expect(() => assertMetadataOnly('task_log', row as Record<string, unknown>)).toThrow(MetadataViolation);
  });

  it('only syncs known preference fields', () => {
    expect(() => assertMetadataOnly('user_settings', { theme: 'aurora', retentionHours: 72 })).not.toThrow();
    expect(() => assertMetadataOnly('user_settings', { apiKey: GOOGLE_KEY })).toThrow(MetadataViolation);
    expect(() => assertMetadataOnly('user_settings', { retentionHours: 999 })).toThrow(MetadataViolation);
  });

  it('rejects unknown tables', () => {
    expect(() => assertMetadataOnly('workspaces', {})).toThrow(MetadataViolation);
  });
});

describe('crash report scrubbing', () => {
  it('redacts keys and tokens in messages', () => {
    const out = scrubString(`fetch failed for key ${GOOGLE_KEY} with Authorization: Bearer ghp_aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5`);
    expect(out).not.toContain(GOOGLE_KEY);
    expect(out).not.toContain('ghp_');
  });

  it('drops source-looking payloads and sensitive keys from extras', () => {
    const v = scrubValue({ message: SOURCE, extra: { content: 'x', apiKey: GOOGLE_KEY, count: 3 } }) as Record<string, unknown>;
    expect(JSON.stringify(v)).not.toContain('connect()');
    expect(JSON.stringify(v)).not.toContain(GOOGLE_KEY);
    expect((v.extra as Record<string, unknown>).count).toBe(3);
  });
});

describe('the token-broker exception is narrow', () => {
  // GitHub user tokens do transit the github-oauth / github-scoped-token functions by design
  // (the GitHub App secret must stay server-side). Nothing else may use that path.
  function backendWith(invoke: jest.Mock) {
    const { createBackendApi } = jest.requireActual<typeof import('@/core/backend/api')>('@/core/backend/api');
    return createBackendApi({ functions: { invoke }, auth: {}, from: jest.fn(), rpc: jest.fn() } as never);
  }

  it('only invokes the two token-broker functions', async () => {
    const invoke = jest.fn().mockResolvedValue({ data: { ok: true }, error: null });
    const api = backendWith(invoke);
    await expect(api.invoke('github-oauth', { grant_type: 'refresh_token', refresh_token: 'r' })).resolves.toEqual({ ok: true });
    await expect(api.invoke('notify' as never, { anything: SOURCE })).rejects.toBeInstanceOf(MetadataViolation);
    await expect(api.invoke('delete-account' as never, {})).rejects.toBeInstanceOf(MetadataViolation);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('never stores a secret-looking device name', async () => {
    const rpc = jest.fn().mockResolvedValue({ error: null });
    const { createBackendApi } = jest.requireActual<typeof import('@/core/backend/api')>('@/core/backend/api');
    const api = createBackendApi({ functions: { invoke: jest.fn() }, auth: {}, from: jest.fn(), rpc } as never);
    await api.registerDevice({
      device_id: 'dev1',
      name: GOOGLE_KEY,
      platform: 'ios',
      push_token: null,
      app_version: '1.0.0',
      session_id: null,
    });
    expect(rpc).toHaveBeenCalledWith('register_device', expect.objectContaining({ p_name: 'ios' }));
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(GOOGLE_KEY);
  });
});

import { migrate } from '@/core/db/migrations';
import { baseLookup } from '@/core/github/repos';
import { utf8 } from '@/core/security/crypto';
import type { ChangeSet } from '@/core/types';
import { pushWorkspace, recoverInterruptedPushes } from '@/core/workspace/pushFlow';
import { DEFAULT_RETENTION, HOUR, WorkspaceGoneError, WorkspaceStore } from '@/core/workspace/store';
import { FakeGitHub } from './helpers/fakeGitHub';
import { createTestPlatform, readAllBytes, type TestPlatform } from './helpers/platform';

const MARKER_NEW = 'HALCYX_SECRET_SOURCE_7f3a9c';
const MARKER_PATH = 'src/very-private-module-name-91b2.ts';

const checks = { lint: { status: 'passed' as const, summary: 'ok' }, tests: { status: 'passed' as const, summary: '12 passed' } };

function changeSet(): ChangeSet {
  return {
    files: [
      { path: 'README.md', bytes: utf8.encode('# Demo\n') }, // unchanged → must be skipped
      { path: 'src/app.ts', bytes: utf8.encode(`export const a = 1;\nexport const v = "${MARKER_NEW}";\n`) },
      { path: MARKER_PATH, bytes: utf8.encode(`// ${MARKER_NEW} added file\n`) },
    ],
    deleted: ['old.txt'],
    summary: `Adds feature (${MARKER_NEW})`,
    commitMessage: 'feat: add feature',
    checks,
  };
}

async function setup(now: () => number = Date.now) {
  const p = createTestPlatform();
  await migrate(p.db);
  const fake = new FakeGitHub({ 'README.md': '# Demo\n', 'src/app.ts': 'export const a = 1;\n', 'old.txt': 'bye\n' });
  const gh = fake.asClient();
  const store = new WorkspaceStore(p, now);
  const id = await store.create({
    taskId: 'task-1',
    repoFull: 'octo/demo',
    provider: 'gemini',
    baseBranch: 'main',
    baseSha: fake.baseSha,
    targetBranch: 'halcyx/add-feature',
    environmentId: null,
    retentionMs: DEFAULT_RETENTION,
  });
  await store.ingest(id, changeSet(), await baseLookup(gh, 'octo/demo', fake.baseSha));
  return { p, fake, gh, store, id };
}

function assertNoPlaintext(p: TestPlatform) {
  const disk = readAllBytes(p.root);
  expect(disk.includes(Buffer.from(MARKER_NEW))).toBe(false);
  expect(disk.includes(Buffer.from(MARKER_PATH))).toBe(false);
}

describe('ephemeral workspace', () => {
  it('stores only real changes, encrypted at rest', async () => {
    const { p, store, id } = await setup();
    const files = await store.files(id);
    expect(files.map((f) => [f.path, f.change])).toEqual([
      ['old.txt', 'deleted'],
      ['src/app.ts', 'modified'],
      [MARKER_PATH, 'added'],
    ]);
    assertNoPlaintext(p); // plaintext never touches disk, even before push
  });

  it('after a confirmed push, no workspace content is recoverable', async () => {
    const { p, fake, gh, store, id } = await setup();
    const reported: unknown[] = [];
    const out = await pushWorkspace(
      store,
      gh,
      id,
      { overrideSecrets: false, openPullRequest: true, createBranch: true, commitMessage: 'feat: add feature', taskTitle: 'Add feature' },
      async (e) => {
        reported.push(e);
      },
    );
    expect(out.kind).toBe('pushed');
    if (out.kind !== 'pushed') return;

    // Pushed correctly.
    expect(fake.refs.get('halcyx/add-feature')).toBe(out.commitSha);
    expect(fake.fileAt(out.commitSha, 'src/app.ts')).toContain(MARKER_NEW);
    expect(fake.fileAt(out.commitSha, 'old.txt')).toBeNull();
    expect(fake.pulls).toHaveLength(1);

    // Erased: files, rows, key.
    expect(await p.files.list('')).toEqual([]);
    expect(await p.db.all('SELECT * FROM ws_files')).toEqual([]);
    expect(await p.db.all('SELECT * FROM workspaces')).toEqual([]);
    expect([...p.secrets.map.keys()].some((k) => k.startsWith('ws-key.'))).toBe(false);
    await expect(store.get(id)).rejects.toBeInstanceOf(WorkspaceGoneError);
    assertNoPlaintext(p);

    // Only metadata survives.
    const log = await store.pushLog();
    expect(log[0]).toMatchObject({ repo_full: 'octo/demo', branch: 'halcyx/add-feature', commit_sha: out.commitSha, outcome: 'pushed' });
    expect(JSON.stringify(reported)).not.toContain(MARKER_NEW);
  });

  it('never force-pushes and stops when the remote branch moved', async () => {
    const { fake, gh, store, id } = await setup();
    await store.updateMeta(id, { targetBranch: 'main' });
    fake.refs.set('main', 'f'.repeat(40));
    const out = await pushWorkspace(
      store,
      gh,
      id,
      { overrideSecrets: false, openPullRequest: false, createBranch: false, commitMessage: 'x', taskTitle: 'x' },
      async () => undefined,
    );
    expect(out).toEqual({ kind: 'remote_moved', remoteSha: 'f'.repeat(40) });
    expect((await store.get(id)).status).toBe('needs_rebase');
    expect(fake.requests.some((r) => r.method === 'updateRef')).toBe(false);
  });

  it('blocks a push that contains a secret unless explicitly overridden', async () => {
    const { p, fake, gh, store, id } = await setup();
    const leak = 'ghp_aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5';
    await store.ingest(
      id,
      { ...changeSet(), files: [{ path: 'src/app.ts', bytes: utf8.encode(`const t = "${leak}";\n`) }] },
      await baseLookup(gh, 'octo/demo', fake.baseSha),
    );
    const opts = { overrideSecrets: false, openPullRequest: false, createBranch: true, commitMessage: 'x', taskTitle: 'x' };
    const blocked = await pushWorkspace(store, gh, id, opts, async () => undefined);
    expect(blocked.kind).toBe('blocked');
    expect(fake.requests).toHaveLength(0);
    expect(await p.files.list('')).not.toEqual([]); // local copy kept

    const forced = await pushWorkspace(store, gh, id, { ...opts, overrideSecrets: true }, async () => undefined);
    expect(forced.kind).toBe('pushed');
  });

  it('applies per-file and per-hunk decisions', async () => {
    const { gh, store, id } = await setup();
    const files = await store.files(id);
    await store.setDecision(id, files.find((f) => f.path === MARKER_PATH)!.id, 'rejected');
    await store.setDecision(id, files.find((f) => f.path === 'src/app.ts')!.id, 'accepted', [0]);
    const out = await pushWorkspace(
      store,
      gh,
      id,
      { overrideSecrets: false, openPullRequest: false, createBranch: true, commitMessage: 'x', taskTitle: 'x' },
      async () => undefined,
    );
    if (out.kind !== 'pushed') throw new Error(out.kind);
    expect(out.filesCount).toBe(2); // app.ts (all hunks rejected → base content) + deletion
  });

  it('warns 12h before expiry and crypto-shreds at expiry', async () => {
    let t = 1_000_000;
    const { p, store, id } = await setup(() => t);
    expect(await store.dueForWarning()).toHaveLength(0);
    t += DEFAULT_RETENTION - 11 * HOUR;
    expect((await store.dueForWarning()).map((w) => w.id)).toEqual([id]);
    t += 12 * HOUR;
    expect(await store.expireDue()).toEqual([id]);
    expect(await p.files.list('')).toEqual([]);
    expect((await store.pushLog())[0]?.outcome).toBe('expired');
    assertNoPlaintext(p);
  });

  it('clamps retention to 1h–7d', () => {
    expect(WorkspaceStore.clampRetention(1)).toBe(HOUR);
    expect(WorkspaceStore.clampRetention(30 * 24 * HOUR)).toBe(7 * 24 * HOUR);
  });

  it('recovers a push interrupted after the ref moved', async () => {
    const { p, fake, gh, store, id } = await setup();
    await store.setStatus(id, 'pushing');
    fake.refs.set('halcyx/add-feature', 'c'.repeat(40));
    await store.updateMeta(id, { pendingCommitSha: 'c'.repeat(40) });
    await recoverInterruptedPushes(store, gh);
    expect(await p.db.all('SELECT * FROM workspaces')).toEqual([]);
    assertNoPlaintext(p);
  });
});

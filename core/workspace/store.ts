import type { Platform } from '@/core/platform/types';
import { gitBlobSha, generateKeyMaterial, open, openText, randomId, seal, sealText, utf8 } from '@/core/security/crypto';
import type { ChangeSet, FileChangeKind, ProviderId, SandboxChecks } from '@/core/types';
import { applyHunkDecisions, isBinary } from './diff';

export type WorkspaceStatus = 'syncing' | 'ready' | 'pushing' | 'needs_rebase' | 'pushed' | 'expired' | 'discarded';

export type WorkspaceMeta = {
  baseBranch: string;
  baseSha: string;
  targetBranch: string;
  summary: string;
  commitMessage: string;
  checks: SandboxChecks;
  environmentId: string | null;
  openPullRequest: boolean;
  /** Commit created but ref not yet confirmed — used for crash-safe push recovery. */
  pendingCommitSha: string | null;
  remoteHeadSha: string | null;
};

export type Workspace = {
  id: string;
  taskId: string;
  repoFull: string;
  provider: ProviderId;
  status: WorkspaceStatus;
  createdAt: number;
  expiresAt: number;
  warned: boolean;
  meta: WorkspaceMeta;
};

export type WorkspaceFile = {
  id: string;
  path: string;
  change: FileChangeKind;
  size: number;
  binary: boolean;
  mode: string;
  decision: 'accepted' | 'rejected';
  rejectedHunks: number[];
};

export type BaseEntry = { sha: string; mode: string };
export type FinalFile = { path: string; bytes: Uint8Array | null; mode: string };

type WsRow = {
  id: string;
  task_id: string;
  repo_full: string;
  provider: ProviderId;
  status: WorkspaceStatus;
  created_at: number;
  expires_at: number;
  warned: number;
  meta_enc: string;
};
type FileRow = {
  id: string;
  path_enc: string;
  change: FileChangeKind;
  size: number;
  binary: number;
  mode: string;
  decision: 'accepted' | 'rejected';
  rejected_hunks: string;
};

export const HOUR = 3_600_000;
export const MIN_RETENTION = HOUR;
export const MAX_RETENTION = 7 * 24 * HOUR;
export const DEFAULT_RETENTION = 72 * HOUR;
export const WARN_BEFORE = 12 * HOUR;

const keyName = (id: string) => `ws-key.${id}`;
const dirOf = (id: string) => `ws/${id}`;
const blobPath = (id: string, fileId: string, side: 'head' | 'base') => `${dirOf(id)}/${fileId}.${side}`;

export class WorkspaceGoneError extends Error {
  constructor(id: string) {
    super(`Workspace ${id} no longer exists (pushed, expired or discarded).`);
  }
}

/**
 * Ephemeral, encrypted, per-workspace code cache. Every byte of agent output is sealed with
 * the workspace's own AES-256-GCM key; `shred()` deletes files and rows and then destroys the
 * key, so any remnant (journal pages, flash wear-levelling copies) is unreadable.
 */
export class WorkspaceStore {
  constructor(
    private readonly p: Platform,
    private readonly now: () => number = Date.now,
  ) {}

  private async key(id: string): Promise<string> {
    const k = await this.p.secrets.get(keyName(id));
    if (!k) throw new WorkspaceGoneError(id);
    return k;
  }

  static clampRetention(ms: number): number {
    return Math.min(MAX_RETENTION, Math.max(MIN_RETENTION, ms));
  }

  async create(input: {
    taskId: string;
    repoFull: string;
    provider: ProviderId;
    baseBranch: string;
    baseSha: string;
    targetBranch: string;
    environmentId: string | null;
    retentionMs: number;
  }): Promise<string> {
    const id = randomId();
    await this.p.secrets.set(keyName(id), generateKeyMaterial());
    const meta: WorkspaceMeta = {
      baseBranch: input.baseBranch,
      baseSha: input.baseSha,
      targetBranch: input.targetBranch,
      summary: '',
      commitMessage: '',
      checks: { lint: { status: 'not_run', summary: '' }, tests: { status: 'not_run', summary: '' } },
      environmentId: input.environmentId,
      openPullRequest: true,
      pendingCommitSha: null,
      remoteHeadSha: null,
    };
    const created = this.now();
    await this.p.db.run(
      `INSERT INTO workspaces (id, task_id, repo_full, provider, status, created_at, expires_at, meta_enc)
       VALUES (?, ?, ?, ?, 'syncing', ?, ?, ?)`,
      [
        id,
        input.taskId,
        input.repoFull,
        input.provider,
        created,
        created + WorkspaceStore.clampRetention(input.retentionMs),
        await sealText(await this.key(id), JSON.stringify(meta), `${id}:meta`),
      ],
    );
    return id;
  }

  async get(id: string): Promise<Workspace> {
    const row = await this.p.db.get<WsRow>('SELECT * FROM workspaces WHERE id = ?', [id]);
    if (!row) throw new WorkspaceGoneError(id);
    const meta = JSON.parse(await openText(await this.key(id), row.meta_enc, `${id}:meta`)) as WorkspaceMeta;
    return {
      id: row.id,
      taskId: row.task_id,
      repoFull: row.repo_full,
      provider: row.provider,
      status: row.status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      warned: row.warned === 1,
      meta,
    };
  }

  async listPending(): Promise<Omit<Workspace, 'meta'>[]> {
    const rows = await this.p.db.all<WsRow>(
      `SELECT * FROM workspaces WHERE status IN ('syncing','ready','pushing','needs_rebase') ORDER BY created_at DESC`,
    );
    return rows.map((r) => ({
      id: r.id,
      taskId: r.task_id,
      repoFull: r.repo_full,
      provider: r.provider,
      status: r.status,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      warned: r.warned === 1,
    }));
  }

  async updateMeta(id: string, patch: Partial<WorkspaceMeta>): Promise<WorkspaceMeta> {
    const ws = await this.get(id);
    const meta = { ...ws.meta, ...patch };
    await this.p.db.run('UPDATE workspaces SET meta_enc = ? WHERE id = ?', [
      await sealText(await this.key(id), JSON.stringify(meta), `${id}:meta`),
      id,
    ]);
    return meta;
  }

  async setStatus(id: string, status: WorkspaceStatus): Promise<void> {
    await this.p.db.run('UPDATE workspaces SET status = ? WHERE id = ?', [status, id]);
  }

  /**
   * Stores the sandbox output. Files whose git blob id equals the base tree's are dropped,
   * so only real changes are cached. Existing entries are replaced (re-sync after rebase).
   */
  async ingest(id: string, changes: ChangeSet, base: (path: string) => Promise<BaseEntry | null>): Promise<number> {
    const key = await this.key(id);
    await this.clearFiles(id);
    let count = 0;
    for (const f of changes.files) {
      const existing = await base(f.path);
      if (existing && existing.sha === (await gitBlobSha(f.bytes))) continue;
      await this.putFile(id, key, f.path, f.bytes, existing ? 'modified' : 'added', existing?.mode ?? '100644');
      count += 1;
    }
    for (const path of changes.deleted) {
      const existing = await base(path);
      if (!existing) continue;
      await this.putFile(id, key, path, null, 'deleted', existing.mode);
      count += 1;
    }
    await this.updateMeta(id, {
      summary: changes.summary,
      commitMessage: changes.commitMessage,
      checks: changes.checks,
    });
    await this.setStatus(id, 'ready');
    return count;
  }

  private async putFile(
    id: string,
    key: string,
    path: string,
    bytes: Uint8Array | null,
    change: FileChangeKind,
    mode: string,
  ): Promise<void> {
    const fileId = randomId(8);
    if (bytes) await this.p.files.write(blobPath(id, fileId, 'head'), await seal(key, bytes, `${id}:${fileId}:head`));
    await this.p.db.run(`INSERT INTO ws_files (id, workspace_id, path_enc, change, size, binary, mode) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
      fileId,
      id,
      await sealText(key, path, `${id}:${fileId}:path`),
      change,
      bytes?.length ?? 0,
      bytes && isBinary(bytes) ? 1 : 0,
      mode,
    ]);
  }

  private async clearFiles(id: string): Promise<void> {
    await this.p.db.run('DELETE FROM ws_files WHERE workspace_id = ?', [id]);
    await this.p.files.removeDir(dirOf(id));
  }

  async files(id: string): Promise<WorkspaceFile[]> {
    const key = await this.key(id);
    const rows = await this.p.db.all<FileRow>('SELECT * FROM ws_files WHERE workspace_id = ?', [id]);
    const out: WorkspaceFile[] = [];
    for (const r of rows) {
      out.push({
        id: r.id,
        path: await openText(key, r.path_enc, `${id}:${r.id}:path`),
        change: r.change,
        size: r.size,
        binary: r.binary === 1,
        mode: r.mode,
        decision: r.decision,
        rejectedHunks: JSON.parse(r.rejected_hunks) as number[],
      });
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  async readHead(id: string, fileId: string): Promise<Uint8Array | null> {
    const path = blobPath(id, fileId, 'head');
    if (!(await this.p.files.exists(path))) return null;
    return open(await this.key(id), await this.p.files.read(path), `${id}:${fileId}:head`);
  }

  /** Base (pre-change) content, fetched lazily from GitHub and cached encrypted. */
  async readBase(id: string, fileId: string, fetchBase: () => Promise<Uint8Array>): Promise<Uint8Array> {
    const path = blobPath(id, fileId, 'base');
    const key = await this.key(id);
    if (await this.p.files.exists(path)) return open(key, await this.p.files.read(path), `${id}:${fileId}:base`);
    const bytes = await fetchBase();
    await this.p.files.write(path, await seal(key, bytes, `${id}:${fileId}:base`));
    return bytes;
  }

  /** Removes one cached file (used by the storage cleaner for dependency output). */
  async dropFile(id: string, fileId: string): Promise<void> {
    await this.p.files.remove(blobPath(id, fileId, 'head'));
    await this.p.files.remove(blobPath(id, fileId, 'base'));
    await this.p.db.run('DELETE FROM ws_files WHERE id = ? AND workspace_id = ?', [fileId, id]);
  }

  async setDecision(id: string, fileId: string, decision: 'accepted' | 'rejected', rejectedHunks: number[] = []) {
    await this.p.db.run('UPDATE ws_files SET decision = ?, rejected_hunks = ? WHERE id = ? AND workspace_id = ?', [
      decision,
      JSON.stringify(rejectedHunks),
      fileId,
      id,
    ]);
  }

  /** Final content to commit, applying per-file and per-hunk decisions. */
  async finalFiles(id: string, fetchBase: (path: string) => Promise<Uint8Array>): Promise<FinalFile[]> {
    const out: FinalFile[] = [];
    for (const f of await this.files(id)) {
      if (f.decision === 'rejected') continue;
      if (f.change === 'deleted') {
        out.push({ path: f.path, bytes: null, mode: f.mode });
        continue;
      }
      const head = await this.readHead(id, f.id);
      if (!head) continue;
      if (!f.rejectedHunks.length || f.binary || f.change === 'added') {
        out.push({ path: f.path, bytes: head, mode: f.mode });
        continue;
      }
      const base = await this.readBase(id, f.id, () => fetchBase(f.path));
      const merged = applyHunkDecisions(utf8.decode(base), utf8.decode(head), new Set(f.rejectedHunks));
      out.push({ path: f.path, bytes: utf8.encode(merged), mode: f.mode });
    }
    return out;
  }

  /**
   * Crypto-shred: delete ciphertext files and rows, then destroy the key. Only metadata
   * (repo, branch, commit SHA, time) survives, in push_log.
   */
  async shred(
    id: string,
    outcome: 'pushed' | 'expired' | 'discarded',
    record?: { branch: string; commitSha: string | null; prUrl: string | null; filesCount: number },
  ): Promise<void> {
    const row = await this.p.db.get<{ repo_full: string; task_id: string }>('SELECT repo_full, task_id FROM workspaces WHERE id = ?', [id]);
    await this.p.files.removeDir(dirOf(id));
    await this.p.db.transaction(async () => {
      await this.p.db.run('DELETE FROM ws_files WHERE workspace_id = ?', [id]);
      await this.p.db.run('DELETE FROM workspaces WHERE id = ?', [id]);
      if (row) await this.p.db.run('DELETE FROM task_events WHERE task_id = ?', [row.task_id]);
      if (row) {
        await this.p.db.run(
          `INSERT INTO push_log (id, workspace_id, repo_full, branch, commit_sha, pr_url, files_count, outcome, at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            randomId(8),
            id,
            row.repo_full,
            record?.branch ?? '',
            record?.commitSha ?? null,
            record?.prUrl ?? null,
            record?.filesCount ?? 0,
            outcome,
            this.now(),
          ],
        );
      }
    });
    await this.p.secrets.remove(keyName(id));
    await this.p.db.exec('PRAGMA wal_checkpoint(TRUNCATE)').catch(() => undefined);
  }

  /** Workspaces that expire within 12h and haven't been warned yet. */
  async dueForWarning(): Promise<Omit<Workspace, 'meta'>[]> {
    const now = this.now();
    return (await this.listPending()).filter((w) => !w.warned && w.expiresAt - now <= WARN_BEFORE && w.expiresAt > now);
  }

  async markWarned(id: string): Promise<void> {
    await this.p.db.run('UPDATE workspaces SET warned = 1 WHERE id = ?', [id]);
  }

  /** Shreds every workspace past its expiry. Pushing workspaces are left for recovery. */
  async expireDue(): Promise<string[]> {
    const now = this.now();
    const due = (await this.listPending()).filter((w) => w.expiresAt <= now && w.status !== 'pushing');
    for (const w of due) await this.shred(w.id, 'expired');
    return due.map((w) => w.id);
  }

  /** Bytes held per workspace (for the storage cleaner and privacy dashboard). */
  async cacheBytes(id: string): Promise<number> {
    let total = 0;
    for (const f of await this.p.files.list(dirOf(id))) total += await this.p.files.size(f);
    return total;
  }

  async pushLog(limit = 200) {
    return this.p.db.all<{
      id: string;
      repo_full: string;
      branch: string;
      commit_sha: string | null;
      pr_url: string | null;
      files_count: number;
      outcome: string;
      at: number;
    }>('SELECT * FROM push_log ORDER BY at DESC LIMIT ?', [limit]);
  }
}

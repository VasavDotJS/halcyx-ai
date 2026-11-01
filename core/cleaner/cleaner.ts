import type { Platform } from '@/core/platform/types';
import type { ProviderContext } from '@/core/providers/types';
import { adapterFor } from '@/core/providers/registry';
import type { ProviderId } from '@/core/types';
import type { WorkspaceStore } from '@/core/workspace/store';
import { groupReclaimable, type ReclaimGroup } from './patterns';

export type ProjectUsage = {
  key: string;
  repoFull: string;
  where: 'local' | 'remote';
  provider: ProviderId;
  /** workspace id (local) or environment/session id (remote) */
  ref: string;
  lastUsedAt: number;
  groups: ReclaimGroup[];
  reclaimable: number;
};

type SandboxRow = { environment_id: string; provider: ProviderId; repo_full: string; last_used_at: number };

export class StorageCleaner {
  constructor(
    private readonly p: Platform,
    private readonly workspaces: WorkspaceStore,
    private readonly ctxFor: (provider: ProviderId) => Promise<ProviderContext | null>,
    private readonly now: () => number = Date.now,
  ) {}

  async trackSandbox(environmentId: string, provider: ProviderId, repoFull: string): Promise<void> {
    await this.p.db.run('INSERT OR REPLACE INTO sandboxes (environment_id, provider, repo_full, last_used_at) VALUES (?, ?, ?, ?)', [
      environmentId,
      provider,
      repoFull,
      this.now(),
    ]);
  }

  async forgetSandbox(environmentId: string): Promise<void> {
    await this.p.db.run('DELETE FROM sandboxes WHERE environment_id = ?', [environmentId]);
  }

  /** Local: dependency files the agent produced (only `added` files — never edits to tracked files). */
  private async scanLocal(): Promise<ProjectUsage[]> {
    const out: ProjectUsage[] = [];
    for (const w of await this.workspaces.listPending()) {
      const files = (await this.workspaces.files(w.id)).filter((f) => f.change === 'added');
      const groups = groupReclaimable(files.map((f) => ({ path: f.path, bytes: f.size })));
      out.push({
        key: `local:${w.id}`,
        repoFull: w.repoFull,
        where: 'local',
        provider: w.provider,
        ref: w.id,
        lastUsedAt: w.createdAt,
        groups,
        reclaimable: groups.reduce((a, g) => a + g.bytes, 0),
      });
    }
    return out;
  }

  private async scanRemote(): Promise<ProjectUsage[]> {
    const rows = await this.p.db.all<SandboxRow>('SELECT * FROM sandboxes ORDER BY last_used_at DESC');
    const out: ProjectUsage[] = [];
    for (const r of rows) {
      const adapter = adapterFor(r.provider);
      const ctx = await this.ctxFor(r.provider);
      let groups: ReclaimGroup[] = [];
      if (ctx && adapter.scanSandbox) {
        try {
          groups = groupReclaimable(await adapter.scanSandbox(r.environment_id, ctx));
        } catch {
          groups = [];
        }
      }
      out.push({
        key: `remote:${r.environment_id}`,
        repoFull: r.repo_full,
        where: 'remote',
        provider: r.provider,
        ref: r.environment_id,
        lastUsedAt: r.last_used_at,
        groups,
        reclaimable: groups.reduce((a, g) => a + g.bytes, 0),
      });
    }
    return out;
  }

  async scan(): Promise<ProjectUsage[]> {
    const [local, remote] = await Promise.all([this.scanLocal(), this.scanRemote()]);
    return [...local, ...remote].sort((a, b) => b.reclaimable - a.reclaimable);
  }

  async clean(project: ProjectUsage): Promise<void> {
    const roots = project.groups.map((g) => g.root);
    if (!roots.length) return;
    if (project.where === 'local') {
      for (const f of await this.workspaces.files(project.ref)) {
        if (f.change === 'added' && roots.some((r) => f.path === r || f.path.startsWith(`${r}/`))) {
          await this.workspaces.dropFile(project.ref, f.id);
        }
      }
      return;
    }
    const adapter = adapterFor(project.provider);
    const ctx = await this.ctxFor(project.provider);
    if (ctx && adapter.cleanSandbox) await adapter.cleanSandbox(project.ref, roots, ctx);
  }

  async cleanAll(projects: ProjectUsage[]): Promise<number> {
    let freed = 0;
    for (const p of projects) {
      await this.clean(p);
      freed += p.reclaimable;
    }
    return freed;
  }

  /** Auto-clean: remove dependencies from projects untouched for `days` days. */
  async autoClean(days: number): Promise<number> {
    const cutoff = this.now() - days * 86_400_000;
    const stale = (await this.scan()).filter((p) => p.lastUsedAt < cutoff && p.reclaimable > 0);
    return this.cleanAll(stale);
  }
}

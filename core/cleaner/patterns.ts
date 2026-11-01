/**
 * Dependency, build-output and toolchain cache directories. These are reinstallable from
 * lockfiles, so they are safe to reclaim; source files never match.
 */
export const RECLAIMABLE_DIRS = [
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.gradle',
  'Pods',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.turbo',
  '.expo',
  '.parcel-cache',
  '.cache',
  '.pnpm-store',
  '.npm',
  '.yarn/cache',
  '.dart_tool',
  'DerivedData',
  'target',
] as const;

/** Returns the reclaimable root directory for a path (e.g. "web/node_modules"), or null. */
export function reclaimableRoot(path: string): string | null {
  const segs = path.split('/');
  for (let i = 0; i < segs.length; i += 1) {
    const one = segs[i]!;
    const two = i + 1 < segs.length ? `${one}/${segs[i + 1]}` : '';
    if ((RECLAIMABLE_DIRS as readonly string[]).includes(two)) return segs.slice(0, i + 2).join('/');
    if ((RECLAIMABLE_DIRS as readonly string[]).includes(one) && i < segs.length - 1) return segs.slice(0, i + 1).join('/');
  }
  return null;
}

export type ReclaimGroup = { root: string; bytes: number; files: number };

/** Groups file entries by reclaimable root and sums their sizes. */
export function groupReclaimable(entries: { path: string; bytes: number }[]): ReclaimGroup[] {
  const groups = new Map<string, ReclaimGroup>();
  for (const e of entries) {
    const root = reclaimableRoot(e.path);
    if (!root) continue;
    const g = groups.get(root) ?? { root, bytes: 0, files: 0 };
    g.bytes += e.bytes;
    g.files += 1;
    groups.set(root, g);
  }
  return [...groups.values()].sort((a, b) => b.bytes - a.bytes);
}

/**
 * Remote clean command: `git clean -X` only removes files ignored by .gitignore, so tracked
 * source and un-pushed (untracked, not ignored) work can never be deleted.
 */
export function remoteCleanCommand(repoDir: string, roots: string[]): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  return `cd ${q(repoDir)} && git clean -fdX -- ${roots.map(q).join(' ')}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

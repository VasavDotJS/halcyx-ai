import { fromBase64 } from '@/core/security/crypto';
import type { RepoRef } from '@/core/types';
import type { BaseEntry } from '@/core/workspace/store';
import { type GitHub, isNotFound, splitRepo } from './client';

/** Repositories the user granted the HALCYX GitHub App access to (fine-grained, per repo). */
export async function listAccessibleRepos(gh: GitHub): Promise<RepoRef[]> {
  const installs = await gh.paginate(gh.apps.listInstallationsForAuthenticatedUser, { per_page: 100 });
  const repos: RepoRef[] = [];
  for (const inst of installs) {
    const list = await gh.paginate(gh.apps.listInstallationReposForAuthenticatedUser, {
      installation_id: inst.id,
      per_page: 100,
    });
    for (const r of list) repos.push({ owner: r.owner.login, name: r.name, id: r.id, defaultBranch: r.default_branch, private: r.private });
  }
  return repos.sort((a, b) => `${a.owner}/${a.name}`.localeCompare(`${b.owner}/${b.name}`));
}

/** Repository metadata by owner/name (route params carry only these, never a serialized object). */
export async function getRepo(gh: GitHub, owner: string, name: string): Promise<RepoRef> {
  const { data: r } = await gh.repos.get({ owner, repo: name });
  return { owner: r.owner.login, name: r.name, id: r.id, defaultBranch: r.default_branch, private: r.private };
}

export function filterRepos(repos: RepoRef[], query: string): RepoRef[] {
  const q = query.trim().toLowerCase();
  if (!q) return repos;
  return repos.filter((r) => `${r.owner}/${r.name}`.toLowerCase().includes(q));
}

export async function listBranches(gh: GitHub, full: string): Promise<{ name: string; sha: string }[]> {
  const { owner, repo } = splitRepo(full);
  const list = await gh.paginate(gh.repos.listBranches, { owner, repo, per_page: 100 });
  return list.map((b) => ({ name: b.name, sha: b.commit.sha }));
}

export async function branchHead(gh: GitHub, full: string, branch: string): Promise<string | null> {
  const { owner, repo } = splitRepo(full);
  try {
    const { data } = await gh.git.getRef({ owner, repo, ref: `heads/${branch}` });
    return data.object.sha;
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

export async function createBranch(gh: GitHub, full: string, name: string, fromSha: string): Promise<void> {
  const { owner, repo } = splitRepo(full);
  await gh.git.createRef({ owner, repo, ref: `refs/heads/${name}`, sha: fromSha });
}

export async function recentCommits(gh: GitHub, full: string, branch: string, count = 15) {
  const { owner, repo } = splitRepo(full);
  const { data } = await gh.repos.listCommits({ owner, repo, sha: branch, per_page: count });
  return data.map((c) => ({
    sha: c.sha,
    message: c.commit.message.split('\n')[0] ?? '',
    author: c.commit.author?.name ?? c.author?.login ?? 'unknown',
    date: c.commit.author?.date ?? '',
  }));
}

/** Map of path → {blob sha, mode} for a commit; lets the workspace skip unchanged files. */
export async function treeIndex(
  gh: GitHub,
  full: string,
  commitSha: string,
): Promise<{ entries: Map<string, BaseEntry>; truncated: boolean }> {
  const { owner, repo } = splitRepo(full);
  const { data: commit } = await gh.git.getCommit({ owner, repo, commit_sha: commitSha });
  const { data } = await gh.git.getTree({ owner, repo, tree_sha: commit.tree.sha, recursive: 'true' });
  const entries = new Map<string, BaseEntry>();
  for (const e of data.tree) if (e.type === 'blob' && e.path && e.sha) entries.set(e.path, { sha: e.sha, mode: e.mode ?? '100644' });
  return { entries, truncated: data.truncated };
}

/** Base-tree lookup used by WorkspaceStore.ingest; falls back to per-path calls for huge repos. */
export async function baseLookup(gh: GitHub, full: string, commitSha: string) {
  const { entries, truncated } = await treeIndex(gh, full, commitSha);
  return async (path: string): Promise<BaseEntry | null> => entries.get(path) ?? (truncated ? lookupPath(gh, full, commitSha, path) : null);
}

/** Looks up a single path when the tree index was truncated (very large repositories). */
export async function lookupPath(gh: GitHub, full: string, ref: string, path: string): Promise<BaseEntry | null> {
  const { owner, repo } = splitRepo(full);
  try {
    const { data } = await gh.repos.getContent({ owner, repo, path, ref });
    if (Array.isArray(data) || data.type !== 'file') return null;
    return { sha: data.sha, mode: '100644' };
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

export async function readFileAt(gh: GitHub, full: string, ref: string, path: string): Promise<Uint8Array> {
  const { owner, repo } = splitRepo(full);
  const { data } = await gh.repos.getContent({ owner, repo, path, ref });
  if (Array.isArray(data) || data.type !== 'file') throw new Error(`${path} is not a file`);
  if (data.content && data.encoding === 'base64') return fromBase64(data.content);
  const { data: blob } = await gh.git.getBlob({ owner, repo, file_sha: data.sha });
  return fromBase64(blob.content);
}

export async function listPaths(gh: GitHub, full: string, commitSha: string): Promise<string[]> {
  return [...(await treeIndex(gh, full, commitSha)).entries.keys()];
}

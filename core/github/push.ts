import { toBase64 } from '@/core/security/crypto';
import type { FinalFile } from '@/core/workspace/store';
import { type GitHub, isNotFound, splitRepo } from './client';

/** The target branch moved since the agent started; the caller must rebase before pushing. */
export class RemoteMovedError extends Error {
  constructor(
    readonly branch: string,
    readonly remoteSha: string,
  ) {
    super(`${branch} moved to ${remoteSha.slice(0, 7)} since the agent started.`);
  }
}

export class NothingToPushError extends Error {
  constructor() {
    super('Every change was rejected — there is nothing to commit.');
  }
}

export type PushInput = {
  repoFull: string;
  baseSha: string;
  branch: string;
  /** true → create `branch` from baseSha; false → fast-forward an existing branch. */
  createBranch: boolean;
  message: string;
  files: FinalFile[];
  /** Persist the commit SHA before the ref moves, so a crash mid-push can be reconciled. */
  onCommitCreated: (sha: string) => Promise<void>;
};

export type PushResult = { commitSha: string; branch: string };

/** Lowercase, dash-separated slug suitable for `halcyx/<slug>`. */
export function slugify(text: string, max = 40): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return s || 'task';
}

export async function uniqueBranchName(gh: GitHub, repoFull: string, base: string): Promise<string> {
  const { owner, repo } = splitRepo(repoFull);
  for (let n = 1; n < 50; n += 1) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    try {
      await gh.git.getRef({ owner, repo, ref: `heads/${candidate}` });
    } catch (e) {
      if (isNotFound(e)) return candidate;
      throw e;
    }
  }
  throw new Error('Could not find a free branch name.');
}

/**
 * Pushes via the Git Data API: blobs → tree → commit → ref. Never force-pushes: existing
 * branches are only fast-forwarded from the exact base the agent worked on.
 */
export async function pushChanges(gh: GitHub, input: PushInput): Promise<PushResult> {
  if (!input.files.length) throw new NothingToPushError();
  const { owner, repo } = splitRepo(input.repoFull);

  if (!input.createBranch) {
    const { data } = await gh.git.getRef({ owner, repo, ref: `heads/${input.branch}` });
    if (data.object.sha !== input.baseSha) throw new RemoteMovedError(input.branch, data.object.sha);
  }

  const { data: baseCommit } = await gh.git.getCommit({ owner, repo, commit_sha: input.baseSha });

  const tree: { path: string; mode: '100644' | '100755' | '120000'; type: 'blob'; sha: string | null }[] = [];
  for (const f of input.files) {
    const mode = f.mode === '100755' || f.mode === '120000' ? f.mode : '100644';
    if (f.bytes === null) {
      tree.push({ path: f.path, mode, type: 'blob', sha: null });
      continue;
    }
    const { data: blob } = await gh.git.createBlob({ owner, repo, content: toBase64(f.bytes), encoding: 'base64' });
    tree.push({ path: f.path, mode, type: 'blob', sha: blob.sha });
  }

  const { data: newTree } = await gh.git.createTree({ owner, repo, base_tree: baseCommit.tree.sha, tree });
  const { data: commit } = await gh.git.createCommit({
    owner,
    repo,
    message: input.message,
    tree: newTree.sha,
    parents: [input.baseSha],
  });
  await input.onCommitCreated(commit.sha);

  if (input.createBranch) {
    await gh.git.createRef({ owner, repo, ref: `refs/heads/${input.branch}`, sha: commit.sha });
  } else {
    await gh.git.updateRef({ owner, repo, ref: `heads/${input.branch}`, sha: commit.sha, force: false });
  }

  if (!(await isPushConfirmed(gh, input.repoFull, input.branch, commit.sha))) {
    throw new Error('GitHub did not confirm the new branch head; the local copy was kept.');
  }
  return { commitSha: commit.sha, branch: input.branch };
}

/** True when `branch` on GitHub points at `commitSha` (used after push and for crash recovery). */
export async function isPushConfirmed(gh: GitHub, repoFull: string, branch: string, commitSha: string) {
  const { owner, repo } = splitRepo(repoFull);
  try {
    const { data } = await gh.git.getRef({ owner, repo, ref: `heads/${branch}` });
    return data.object.sha === commitSha;
  } catch (e) {
    if (isNotFound(e)) return false;
    throw e;
  }
}

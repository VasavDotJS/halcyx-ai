import type { GitHub } from '@/core/github/client';
import { openPullRequest, pullBody } from '@/core/github/pulls';
import { isPushConfirmed, pushChanges, RemoteMovedError } from '@/core/github/push';
import { readFileAt } from '@/core/github/repos';
import { reported, reportError } from '@/core/monitoring/report';
import { preflight, type Preflight } from './preflight';
import type { WorkspaceStore } from './store';

export type PushOptions = {
  overrideSecrets: boolean;
  openPullRequest: boolean;
  /** true when targetBranch is the new `halcyx/<slug>` branch HALCYX creates. */
  createBranch: boolean;
  commitMessage: string;
  taskTitle: string;
};

export type PushOutcome =
  | { kind: 'blocked'; preflight: Preflight }
  | { kind: 'remote_moved'; remoteSha: string }
  | { kind: 'pushed'; commitSha: string; branch: string; prUrl: string | null; filesCount: number; warnings: string[] };

/** Metadata-only reporter (backend task_log). Never receives file contents or keys. */
export type PushReporter = (event: {
  workspaceId: string;
  taskId: string;
  repoFull: string;
  branch: string;
  commitSha: string;
  filesCount: number;
}) => Promise<void>;

/**
 * Review → push → erase. The workspace is shredded only after GitHub confirms the new ref.
 * Any failure before that leaves the encrypted local copy intact.
 */
export async function pushWorkspace(
  store: WorkspaceStore,
  gh: GitHub,
  workspaceId: string,
  opts: PushOptions,
  report: PushReporter,
): Promise<PushOutcome> {
  const ws = await store.get(workspaceId);
  const fetchBase = (path: string) => readFileAt(gh, ws.repoFull, ws.meta.baseSha, path);
  const files = await store.finalFiles(workspaceId, fetchBase);
  const check = preflight(files, ws.meta.checks, opts.overrideSecrets);
  if (check.blocked) return { kind: 'blocked', preflight: check };

  await store.setStatus(workspaceId, 'pushing');
  await store.updateMeta(workspaceId, { commitMessage: opts.commitMessage, openPullRequest: opts.openPullRequest });

  let result;
  try {
    result = await pushChanges(gh, {
      repoFull: ws.repoFull,
      baseSha: ws.meta.baseSha,
      branch: ws.meta.targetBranch,
      createBranch: opts.createBranch,
      message: opts.commitMessage,
      files,
      onCommitCreated: async (sha) => {
        await store.updateMeta(workspaceId, { pendingCommitSha: sha });
      },
    });
  } catch (e) {
    if (e instanceof RemoteMovedError) {
      await store.updateMeta(workspaceId, { remoteHeadSha: e.remoteSha, pendingCommitSha: null });
      await store.setStatus(workspaceId, 'needs_rebase');
      return { kind: 'remote_moved', remoteSha: e.remoteSha };
    }
    await store.setStatus(workspaceId, 'ready');
    throw e;
  }

  let prUrl: string | null = null;
  const warnings: string[] = [];
  if (opts.openPullRequest && opts.createBranch) {
    try {
      const pr = await openPullRequest(gh, ws.repoFull, {
        head: result.branch,
        base: ws.meta.baseBranch,
        title: opts.commitMessage.split('\n')[0] ?? opts.taskTitle,
        body: pullBody(ws.meta.summary, { lint: ws.meta.checks.lint.status, tests: ws.meta.checks.tests.status }, opts.taskTitle),
      });
      prUrl = pr.url;
    } catch (e) {
      prUrl = null;
      warnings.push(`Pushed, but the pull request couldn’t be opened: ${(e as Error).message}`.slice(0, 300));
      reportError('push.openPullRequest', e);
    }
  }

  await store.shred(workspaceId, 'pushed', {
    branch: result.branch,
    commitSha: result.commitSha,
    prUrl,
    filesCount: files.length,
  });
  await report({
    workspaceId,
    taskId: ws.taskId,
    repoFull: ws.repoFull,
    branch: result.branch,
    commitSha: result.commitSha,
    filesCount: files.length,
  }).catch(reported('push.report'));
  return { kind: 'pushed', commitSha: result.commitSha, branch: result.branch, prUrl, filesCount: files.length, warnings };
}

/**
 * Crash-safe recovery: a workspace left in `pushing` either made it to GitHub (shred it) or
 * didn't (return it to `ready` for another attempt). Called on every app start.
 */
export async function recoverInterruptedPushes(store: WorkspaceStore, gh: GitHub): Promise<void> {
  for (const w of await store.listPending()) {
    if (w.status !== 'pushing') continue;
    const ws = await store.get(w.id);
    const sha = ws.meta.pendingCommitSha;
    if (sha && (await isPushConfirmed(gh, ws.repoFull, ws.meta.targetBranch, sha))) {
      await store.shred(w.id, 'pushed', { branch: ws.meta.targetBranch, commitSha: sha, prUrl: null, filesCount: 0 });
    } else {
      await store.updateMeta(w.id, { pendingCommitSha: null });
      await store.setStatus(w.id, 'ready');
    }
  }
}

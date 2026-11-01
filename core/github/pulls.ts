import { type GitHub, splitRepo } from './client';

export type PullSummary = { number: number; title: string; url: string; head: string; state: string; draft: boolean };

export async function openPullRequest(
  gh: GitHub,
  repoFull: string,
  input: { head: string; base: string; title: string; body: string },
): Promise<PullSummary> {
  const { owner, repo } = splitRepo(repoFull);
  const { data } = await gh.pulls.create({ owner, repo, ...input });
  return { number: data.number, title: data.title, url: data.html_url, head: data.head.ref, state: data.state, draft: !!data.draft };
}

export async function listOpenPulls(gh: GitHub, repoFull: string): Promise<PullSummary[]> {
  const { owner, repo } = splitRepo(repoFull);
  const { data } = await gh.pulls.list({ owner, repo, state: 'open', per_page: 30 });
  return data.map((p) => ({ number: p.number, title: p.title, url: p.html_url, head: p.head.ref, state: p.state, draft: !!p.draft }));
}

export async function mergePullRequest(
  gh: GitHub,
  repoFull: string,
  number: number,
  method: 'merge' | 'squash' | 'rebase' = 'squash',
): Promise<{ merged: boolean; sha: string }> {
  const { owner, repo } = splitRepo(repoFull);
  const { data } = await gh.pulls.merge({ owner, repo, pull_number: number, merge_method: method });
  return { merged: data.merged, sha: data.sha };
}

/** Builds the PR body from the AI summary plus sandbox check results. */
export function pullBody(summary: string, checks: { lint: string; tests: string }, taskTitle: string): string {
  return [
    summary.trim() || taskTitle,
    '',
    '---',
    `Lint: ${checks.lint} · Tests: ${checks.tests}`,
    '',
    '_Opened from HALCYX after on-device review._',
  ].join('\n');
}

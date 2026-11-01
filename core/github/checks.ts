import { type GitHub, splitRepo } from './client';

export type CheckState = 'success' | 'failure' | 'pending' | 'neutral';
export type CheckItem = { name: string; state: CheckState; url: string | null };

function fromRun(status: string, conclusion: string | null): CheckState {
  if (status !== 'completed') return 'pending';
  if (conclusion === 'success') return 'success';
  if (conclusion === 'failure' || conclusion === 'timed_out' || conclusion === 'cancelled' || conclusion === 'action_required')
    return 'failure';
  return 'neutral';
}

/** CI status for a commit: GitHub Actions check runs plus legacy commit statuses. */
export async function checksFor(gh: GitHub, repoFull: string, ref: string): Promise<{ overall: CheckState; items: CheckItem[] }> {
  const { owner, repo } = splitRepo(repoFull);
  const [{ data: runs }, { data: combined }] = await Promise.all([
    gh.checks.listForRef({ owner, repo, ref, per_page: 100 }),
    gh.repos.getCombinedStatusForRef({ owner, repo, ref }),
  ]);
  const items: CheckItem[] = [
    ...runs.check_runs.map((r) => ({ name: r.name, state: fromRun(r.status, r.conclusion), url: r.html_url ?? null })),
    ...combined.statuses.map((s) => ({
      name: s.context,
      state: (s.state === 'success' ? 'success' : s.state === 'pending' ? 'pending' : 'failure') as CheckState,
      url: s.target_url ?? null,
    })),
  ];
  const overall: CheckState = items.some((i) => i.state === 'failure')
    ? 'failure'
    : items.some((i) => i.state === 'pending')
      ? 'pending'
      : items.length
        ? 'success'
        : 'neutral';
  return { overall, items };
}

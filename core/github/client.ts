import { Octokit } from '@octokit/rest';

/** Octokit bound to a token provider so every request uses a fresh (auto-refreshed) token. */
export function createGitHubClient(token: () => Promise<string>, fetchImpl: typeof fetch = fetch): Octokit {
  const gh = new Octokit({ userAgent: 'HALCYX', request: { fetch: fetchImpl } });
  gh.hook.before('request', async (options) => {
    options.headers.authorization = `token ${await token()}`;
  });
  return gh;
}

export type GitHub = Octokit;

export function splitRepo(full: string): { owner: string; repo: string } {
  const [owner, repo] = full.split('/');
  if (!owner || !repo) throw new Error(`Invalid repository name: ${full}`);
  return { owner, repo };
}

export function isNotFound(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { status?: number }).status === 404;
}

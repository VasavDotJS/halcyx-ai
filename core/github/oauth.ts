import { pkcePair, randomId } from '@/core/security/crypto';
import type { GitHubTokens } from './tokens';

/**
 * GitHub App OAuth with PKCE. The authorization happens in the system browser; the code is
 * exchanged by the `github-oauth` Edge Function because GitHub Apps require a client secret,
 * which must never ship inside the app.
 */
export type AuthorizeRequest = { url: string; state: string; verifier: string };

export async function buildAuthorizeRequest(clientId: string, redirectUri: string): Promise<AuthorizeRequest> {
  const { verifier, challenge } = await pkcePair();
  const state = randomId();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return { url: `https://github.com/login/oauth/authorize?${params.toString()}`, state, verifier };
}

export function parseCallback(url: string, expectedState: string): string {
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  const params = new URLSearchParams(query.split('#')[0]);
  const error = params.get('error');
  if (error) throw new Error(params.get('error_description') ?? error);
  if (params.get('state') !== expectedState) throw new Error('OAuth state mismatch — please try again.');
  const code = params.get('code');
  if (!code) throw new Error('GitHub did not return an authorization code.');
  return code;
}

type ExchangeResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
};

export function toTokens(r: ExchangeResponse, now = Date.now()): GitHubTokens {
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token ?? null,
    expiresAt: r.expires_in ? now + r.expires_in * 1000 : null,
    refreshExpiresAt: r.refresh_token_expires_in ? now + r.refresh_token_expires_in * 1000 : null,
  };
}

/** Calls an Edge Function; injected so core stays independent of the Supabase client. */
export type FunctionInvoker = <T>(name: string, body: Record<string, unknown>) => Promise<T>;

export function createExchange(invoke: FunctionInvoker) {
  return {
    async code(code: string, verifier: string, redirectUri: string): Promise<GitHubTokens> {
      return toTokens(
        await invoke<ExchangeResponse>('github-oauth', {
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
          redirect_uri: redirectUri,
        }),
      );
    },
    async refresh(refreshToken: string): Promise<GitHubTokens> {
      return toTokens(await invoke<ExchangeResponse>('github-oauth', { grant_type: 'refresh_token', refresh_token: refreshToken }));
    },
    /** Read-only, single-repo token for the agent sandbox (cannot push, cannot force-push). */
    async scopedReadToken(userToken: string, repositoryId: number): Promise<string> {
      const r = await invoke<{ token: string }>('github-scoped-token', {
        access_token: userToken,
        repository_id: repositoryId,
      });
      return r.token;
    },
  };
}

export type GitHubExchange = ReturnType<typeof createExchange>;

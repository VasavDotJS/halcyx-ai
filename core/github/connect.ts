import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { appUrl } from '@/core/platform/links';
import { buildAuthorizeRequest, type createExchange, parseCallback } from './oauth';
import type { GitHubTokenManager } from './tokens';

/** Only what the connect flow needs (keeps core/github independent of app wiring). */
export type GitHubConnectDeps = {
  githubExchange: ReturnType<typeof createExchange>;
  githubTokens: Pick<GitHubTokenManager, 'save' | 'clear'>;
};

type Extra = { githubAppClientId?: string; githubAppSlug?: string };
const extra = () => (Constants.expoConfig?.extra ?? {}) as Extra;

const WEB_PENDING = 'halcyx.github-oauth';
type PendingWebAuth = { state: string; verifier: string; redirectUri: string; returnTo: string; at: number };

/**
 * GitHub App user authorization (OAuth + PKCE). Native: the system auth session.
 * Web: a full-page redirect. The PWA is cross-origin isolated (COOP same-origin), which severs
 * the link to an OAuth popup, so the popup flow can't complete there. The PKCE verifier and
 * state wait in sessionStorage (this tab only) until /github-callback finishes the exchange.
 */
export async function connectGitHub(s: GitHubConnectDeps, returnTo = '/(tabs)/projects'): Promise<boolean> {
  const clientId = extra().githubAppClientId;
  if (!clientId) throw new Error('GitHub App is not configured (EXPO_PUBLIC_GITHUB_APP_CLIENT_ID).');
  const redirectUri = appUrl('github-callback');
  const req = await buildAuthorizeRequest(clientId, redirectUri);
  if (Platform.OS === 'web') {
    const pending: PendingWebAuth = { state: req.state, verifier: req.verifier, redirectUri, returnTo, at: Date.now() };
    globalThis.sessionStorage.setItem(WEB_PENDING, JSON.stringify(pending));
    globalThis.location.assign(req.url);
    return false;
  }
  const result = await WebBrowser.openAuthSessionAsync(req.url, redirectUri, { preferEphemeralSession: false });
  if (result.type !== 'success') return false;
  const code = parseCallback(result.url, req.state);
  const tokens = await s.githubExchange.code(code, req.verifier, redirectUri);
  await s.githubTokens.save(tokens);
  return true;
}

/** Fine-grained, per-repo access is granted on the App's installation page. */
export async function manageRepoAccess(): Promise<void> {
  const slug = extra().githubAppSlug;
  if (!slug) throw new Error('GitHub App slug is not configured (EXPO_PUBLIC_GITHUB_APP_SLUG).');
  await WebBrowser.openBrowserAsync(`https://github.com/apps/${slug}/installations/new`);
}

export async function disconnectGitHub(s: GitHubConnectDeps): Promise<void> {
  await s.githubTokens.clear();
}

/** Web only: completes a redirect started by connectGitHub. Returns where to go next. */
export async function completeWebGitHubConnect(s: GitHubConnectDeps, callbackUrl: string): Promise<string> {
  const raw = globalThis.sessionStorage.getItem(WEB_PENDING);
  globalThis.sessionStorage.removeItem(WEB_PENDING);
  let pending: PendingWebAuth | null = null;
  try {
    pending = raw ? (JSON.parse(raw) as PendingWebAuth) : null;
  } catch {
    pending = null;
  }
  if (!pending || Date.now() - pending.at > 10 * 60_000) throw new Error('This GitHub sign-in expired. Please connect again.');
  const code = parseCallback(callbackUrl, pending.state);
  const tokens = await s.githubExchange.code(code, pending.verifier, pending.redirectUri);
  await s.githubTokens.save(tokens);
  return pending.returnTo;
}

import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import type { Services } from '@/core/app/services';
import { buildAuthorizeRequest, parseCallback } from './oauth';

type Extra = { githubAppClientId?: string; githubAppSlug?: string };
const extra = () => (Constants.expoConfig?.extra ?? {}) as Extra;

/** GitHub App user authorization (OAuth + PKCE) in the system browser. */
export async function connectGitHub(s: Services): Promise<boolean> {
  const clientId = extra().githubAppClientId;
  if (!clientId) throw new Error('GitHub App is not configured (EXPO_PUBLIC_GITHUB_APP_CLIENT_ID).');
  const redirectUri = Linking.createURL('github-callback');
  const req = await buildAuthorizeRequest(clientId, redirectUri);
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

export async function disconnectGitHub(s: Services): Promise<void> {
  await s.githubTokens.clear();
}

import type { SupabaseClient } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { appUrl } from '@/core/platform/links';

WebBrowser.maybeCompleteAuthSession();

export const callbackUrl = (params = '') => appUrl(`auth-callback${params}`);

export async function signInWithPassword(sb: SupabaseClient, email: string, password: string) {
  const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
}

export async function signUp(sb: SupabaseClient, email: string, password: string) {
  const { data, error } = await sb.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: callbackUrl() } });
  if (error) throw error;
  return { needsVerification: !data.session };
}

export async function sendMagicLink(sb: SupabaseClient, email: string) {
  const { error } = await sb.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: callbackUrl() } });
  if (error) throw error;
}

export async function resendVerification(sb: SupabaseClient, email: string) {
  const { error } = await sb.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: callbackUrl() } });
  if (error) throw error;
}

export async function requestPasswordReset(sb: SupabaseClient, email: string) {
  const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: callbackUrl('?type=recovery') });
  if (error) throw error;
}

export async function updatePassword(sb: SupabaseClient, password: string) {
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw error;
}

/** Exchanges the PKCE code from a magic link / OAuth / recovery redirect. */
export async function completeFromUrl(sb: SupabaseClient, url: string): Promise<'signed_in' | 'recovery' | 'none'> {
  const { queryParams } = Linking.parse(url);
  const code = typeof queryParams?.code === 'string' ? queryParams.code : null;
  const errorDescription = queryParams?.error_description;
  if (typeof errorDescription === 'string') throw new Error(errorDescription);
  if (!code) return 'none';
  const { error } = await sb.auth.exchangeCodeForSession(code);
  if (error) throw error;
  return queryParams?.type === 'recovery' ? 'recovery' : 'signed_in';
}

export type OAuthProvider = 'google' | 'github' | 'apple';

/** Google / GitHub (and Apple off-iOS) via Supabase OAuth + PKCE in the system browser. */
export async function signInWithOAuth(sb: SupabaseClient, provider: OAuthProvider) {
  const redirectTo = callbackUrl();
  if (Platform.OS === 'web') {
    const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo } });
    if (error) throw error;
    return;
  }
  const { data, error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo, skipBrowserRedirect: true } });
  if (error) throw error;
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo, { preferEphemeralSession: true });
  if (result.type === 'success') await completeFromUrl(sb, result.url);
}

/** Native Sign in with Apple (required by App Store rules alongside other social logins). */
export async function signInWithApple(sb: SupabaseClient) {
  if (Platform.OS !== 'ios') return signInWithOAuth(sb, 'apple');
  const rawNonce = Crypto.randomUUID();
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL, AppleAuthentication.AppleAuthenticationScope.FULL_NAME],
    nonce: hashed,
  });
  if (!credential.identityToken) throw new Error('Apple did not return an identity token.');
  const { error } = await sb.auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken, nonce: rawNonce });
  if (error) throw error;
}

export function friendlyAuthError(e: unknown): string {
  const m = (e as Error)?.message ?? 'Something went wrong';
  if (/invalid login credentials/i.test(m)) return 'Email or password is incorrect.';
  if (/email not confirmed/i.test(m)) return 'Please verify your email first — check your inbox.';
  if (/ERR_REQUEST_CANCELED|canceled/i.test(m)) return '';
  return m;
}

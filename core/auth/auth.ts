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

/** Thrown when sign-up is attempted for an email that already has an account. */
export class AccountExistsError extends Error {
  constructor() {
    super('An account with this email already exists. Sign in, or use “Forgot password?” to set a new password.');
  }
}

export async function signUp(sb: SupabaseClient, email: string, password: string) {
  const { data, error } = await sb.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: callbackUrl() } });
  if (error) throw error;
  // For an existing email Supabase returns success with no identities and sends no email
  // (to prevent account enumeration). Tell the user instead of showing "check your inbox".
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) throw new AccountExistsError();
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
  const kind = queryParams?.type === 'recovery' ? 'recovery' : 'signed_in';
  const { error } = await sb.auth.exchangeCodeForSession(code);
  if (error) {
    // A link opened twice (or already exchanged) still counts if this browser is signed in.
    const { data } = await sb.auth.getSession();
    if (data.session) return kind;
    throw error;
  }
  return kind;
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
  const err = e as { message?: string; code?: string; status?: number } | null;
  const m = err?.message ?? 'Something went wrong';
  const code = err?.code ?? '';
  if (/ERR_REQUEST_CANCELED|canceled|cancelled/i.test(m)) return '';
  if (/code verifier not found|pkce/i.test(m)) {
    return 'Open the sign-in link in the same browser you requested it from — it only works there. Or request a new link here.';
  }
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(m)) {
    return 'Email or password is incorrect. If you signed up with a magic link or forgot your password, use “Forgot password?”.';
  }
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(m)) return 'Please confirm your email first. Use the link we sent you.';
  if (code === 'over_email_send_rate_limit' || /email rate limit|rate limit exceeded/i.test(m) || err?.status === 429) {
    return 'Too many emails were requested recently. Wait a few minutes and try again, or sign in with your password.';
  }
  if (code === 'user_already_exists' || /already registered/i.test(m)) return new AccountExistsError().message;
  if (code === 'otp_expired' || /expired|invalid.*(link|token)/i.test(m))
    return 'This sign-in link has expired or was already used. Request a new one.';
  if (/provider is not enabled|unsupported provider/i.test(m)) return 'This sign-in method isn’t available yet. Use email instead.';
  if (code === 'weak_password') return 'Choose a stronger password (at least 10 characters).';
  if (code === 'signup_disabled') return 'New sign-ups are currently closed.';
  return m;
}

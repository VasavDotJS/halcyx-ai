import { AccountExistsError, friendlyAuthError, signUp } from '@/core/auth/auth';
import { FALLBACK_PROVIDERS, fetchAuthProviders, parseAuthSettings } from '@/core/auth/providers';

jest.mock('expo-apple-authentication', () => ({}));
jest.mock('expo-crypto', () => ({}));
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: () => undefined }));
jest.mock('expo-linking', () => ({ createURL: (p: string) => `halcyx://${p}`, parse: () => ({ queryParams: {} }) }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

describe('sign-in providers come from the backend', () => {
  it('shows only enabled social providers', () => {
    expect(parseAuthSettings({ external: { google: false, github: true, apple: false, email: true } })).toEqual({
      google: false,
      github: true,
      apple: false,
      email: true,
    });
  });

  it('hides social sign-in when settings cannot be read', async () => {
    await expect(fetchAuthProviders('https://x.supabase.co', 'k', async () => new Response('nope', { status: 500 }))).resolves.toEqual(
      FALLBACK_PROVIDERS,
    );
    await expect(
      fetchAuthProviders('https://x.supabase.co', 'k', async () => {
        throw new Error('offline');
      }),
    ).resolves.toEqual(FALLBACK_PROVIDERS);
  });

  it('calls the public settings endpoint with the anon key', async () => {
    const f = jest.fn(async () => new Response(JSON.stringify({ external: { github: true } })));
    await fetchAuthProviders('https://x.supabase.co/', 'anon', f);
    expect(f).toHaveBeenCalledWith('https://x.supabase.co/auth/v1/settings', { headers: { apikey: 'anon' } });
  });
});

describe('email sign-up never claims an email was sent when none was', () => {
  const sb = (data: unknown) => ({ auth: { signUp: jest.fn().mockResolvedValue({ data, error: null }) } }) as never;

  it('detects an existing account (Supabase returns no identities and sends nothing)', async () => {
    await expect(signUp(sb({ user: { id: 'u', identities: [] }, session: null }), 'a@b.co', 'longpassword1')).rejects.toBeInstanceOf(
      AccountExistsError,
    );
  });

  it('asks for verification for a genuinely new account', async () => {
    await expect(signUp(sb({ user: { id: 'u', identities: [{ id: 'i' }] }, session: null }), 'a@b.co', 'longpassword1')).resolves.toEqual({
      needsVerification: true,
    });
  });

  it('explains Supabase errors in plain words', () => {
    expect(friendlyAuthError({ message: 'Email rate limit exceeded', code: 'over_email_send_rate_limit', status: 429 })).toMatch(
      /Too many emails/,
    );
    expect(friendlyAuthError({ message: 'Invalid login credentials', code: 'invalid_credentials' })).toMatch(/Forgot password/);
    expect(friendlyAuthError({ message: 'Unsupported provider: provider is not enabled' })).toMatch(/isn’t available/);
    expect(friendlyAuthError({ message: 'Email link is invalid or has expired', code: 'otp_expired' })).toMatch(/expired/);
  });
});

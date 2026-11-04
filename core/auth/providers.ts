/**
 * Which sign-in methods the Supabase project actually has turned on. Read from the public
 * GoTrue settings endpoint so the app never offers a button that ends on
 * "Unsupported provider: provider is not enabled".
 */
export type AuthProviders = { google: boolean; github: boolean; apple: boolean; email: boolean };

/** Used when the settings can't be read (offline): hide social buttons, keep email. */
export const FALLBACK_PROVIDERS: AuthProviders = { google: false, github: false, apple: false, email: true };

type SettingsResponse = { external?: Record<string, unknown>; disable_signup?: boolean };

export function parseAuthSettings(json: unknown): AuthProviders {
  const ext = ((json as SettingsResponse | null)?.external ?? {}) as Record<string, unknown>;
  return { google: ext.google === true, github: ext.github === true, apple: ext.apple === true, email: ext.email !== false };
}

export async function fetchAuthProviders(
  url: string,
  anonKey: string,
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<AuthProviders> {
  try {
    const res = await fetchImpl(`${url.replace(/\/+$/, '')}/auth/v1/settings`, { headers: { apikey: anonKey } });
    if (!res.ok) return FALLBACK_PROVIDERS;
    return parseAuthSettings(await res.json());
  } catch {
    return FALLBACK_PROVIDERS;
  }
}

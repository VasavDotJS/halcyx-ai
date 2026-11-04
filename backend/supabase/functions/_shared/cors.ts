/** Pure helpers (no Deno or npm imports) so they're unit-tested in tests/edgeFunctions.test.ts. */

export function allowedOrigins(
  raw = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get('ALLOWED_ORIGIN') ?? '',
): string[] {
  return raw
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter((s) => /^https?:\/\/[^/\s]+$/.test(s));
}

export type OriginCheck = { ok: boolean; headers: Record<string, string> };

export function checkOrigin(origin: string | null, allowed = allowedOrigins()): OriginCheck {
  const base = { vary: 'Origin' };
  if (!origin) return { ok: true, headers: base };
  if (!allowed.includes(origin)) return { ok: false, headers: base };
  return {
    ok: true,
    headers: {
      ...base,
      'access-control-allow-origin': origin,
      'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-max-age': '600',
    },
  };
}

/** Constant-time string comparison (compares SHA-256 digests so length doesn't leak either). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const ua = new Uint8Array(x);
  const ub = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < ua.length; i += 1) diff |= ua[i]! ^ ub[i]!;
  return diff === 0;
}

import { allowedOrigins, checkOrigin, safeEqual } from '../backend/supabase/functions/_shared/cors';
import { digestPeriodOf, escapeHtml, isDue, mapLimit, render } from '../backend/supabase/functions/email-digest/digest';

describe('Edge Function CORS (fails closed)', () => {
  it('parses the allow-list and drops junk', () => {
    expect(allowedOrigins('https://vasavdotjs.github.io, https://app.example.com/ ,javascript:alert(1),*')).toEqual([
      'https://vasavdotjs.github.io',
      'https://app.example.com',
    ]);
    expect(allowedOrigins('')).toEqual([]);
  });

  it('rejects every browser origin when ALLOWED_ORIGIN is unset', () => {
    const r = checkOrigin('https://evil.example', []);
    expect(r.ok).toBe(false);
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
    expect(r.headers.vary).toBe('Origin');
  });

  it('echoes only an exact allow-listed origin, never *', () => {
    const allowed = ['https://vasavdotjs.github.io'];
    const ok = checkOrigin('https://vasavdotjs.github.io', allowed);
    expect(ok.ok).toBe(true);
    expect(ok.headers['access-control-allow-origin']).toBe('https://vasavdotjs.github.io');
    expect(checkOrigin('https://vasavdotjs.github.io.evil.example', allowed).ok).toBe(false);
    expect(checkOrigin('http://vasavdotjs.github.io', allowed).ok).toBe(false);
  });

  it('lets native apps (no Origin header) through without CORS headers', () => {
    const r = checkOrigin(null, []);
    expect(r.ok).toBe(true);
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('compares secrets in constant time and correctly', async () => {
    await expect(safeEqual('s3cret-value', 's3cret-value')).resolves.toBe(true);
    await expect(safeEqual('s3cret-value', 's3cret-valuf')).resolves.toBe(false);
    await expect(safeEqual('', 's3cret-value')).resolves.toBe(false);
  });
});

describe('email digest never mails opted-out users', () => {
  it('accepts only exactly "daily" or "weekly"', () => {
    expect(digestPeriodOf({ emailDigest: 'daily' })).toBe('daily');
    expect(digestPeriodOf({ emailDigest: 'weekly' })).toBe('weekly');
    for (const prefs of [
      { emailDigest: 'off' },
      { emailDigest: 'Daily' },
      { emailDigest: ['daily'] },
      {},
      null,
      'daily',
      [],
      { theme: 'paper' },
    ]) {
      expect(digestPeriodOf(prefs)).toBeNull();
    }
  });

  it('is due once per period', () => {
    const now = Date.parse('2026-11-04T10:00:00Z');
    expect(isDue('daily', null, now)).toBe(true);
    expect(isDue('daily', '2026-11-04T02:00:00Z', now)).toBe(false);
    expect(isDue('daily', '2026-11-03T10:30:00Z', now)).toBe(true);
    expect(isDue('weekly', '2026-11-01T10:00:00Z', now)).toBe(false);
    expect(isDue('weekly', '2026-10-28T10:00:00Z', now)).toBe(true);
    expect(isDue('weekly', 'not a date', now)).toBe(true);
  });

  it('runs work with bounded concurrency', async () => {
    let inFlight = 0;
    let peak = 0;
    const done: number[] = [];
    await mapLimit([...Array(23).keys()], 5, async (i) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      done.push(i);
      inFlight -= 1;
    });
    expect(peak).toBeLessThanOrEqual(5);
    expect(done.sort((a, b) => a - b)).toEqual([...Array(23).keys()]);
  });

  it('escapes metadata in the email body', () => {
    expect(escapeHtml(`<img src=x onerror="a">'`)).toBe('&lt;img src=x onerror=&quot;a&quot;&gt;&#39;');
    const html = render(
      [{ repo: 'o/<r>', status: 'pushed', model: 'm', input_tokens: 1, output_tokens: 2, cost_usd: 0.5, started_at: '' }],
      'daily',
    );
    expect(html).toContain('o/&lt;r&gt;');
    expect(html).not.toContain('<r>');
  });
});

/** Pure helpers for the email digest (unit-tested in tests/edgeFunctions.test.ts). */
export type DigestPeriod = 'daily' | 'weekly';

export type Row = {
  repo: string;
  status: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  started_at: string;
};

const DAY = 86_400_000;

/** The user's digest period, or null for anything that isn't exactly "daily" or "weekly" (opted out). */
export function digestPeriodOf(prefs: unknown): DigestPeriod | null {
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return null;
  const v = (prefs as Record<string, unknown>).emailDigest;
  return v === 'daily' || v === 'weekly' ? v : null;
}

/** Due when never sent, or when a full period (minus an hour of cron jitter) has passed. */
export function isDue(period: DigestPeriod, lastSentAt: string | null, now: number): boolean {
  if (!lastSentAt) return true;
  const last = new Date(lastSentAt).getTime();
  if (!Number.isFinite(last)) return true;
  const window = period === 'daily' ? DAY : 7 * DAY;
  return now - last >= window - 3_600_000;
}

/** Runs `fn` over `items` with at most `limit` in flight. */
export async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function render(rows: Row[], period: DigestPeriod): string {
  const total = rows.reduce((a, r) => a + Number(r.cost_usd), 0);
  const items = rows
    .slice(0, 50)
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.repo)}</td><td>${escapeHtml(r.status)}</td><td>${escapeHtml(r.model)}</td><td style="text-align:right">${(
          Number(r.input_tokens) + Number(r.output_tokens)
        ).toLocaleString('en-US')}</td></tr>`,
    )
    .join('');
  return `<div style="font-family:-apple-system,Segoe UI,sans-serif;color:#171717">
<h2 style="margin:0 0 8px">Your HALCYX ${period} digest</h2>
<p style="color:#5e5e5e;margin:0 0 16px">${rows.length} tasks · ≈ $${total.toFixed(2)} estimated spend</p>
<table cellpadding="6" style="border-collapse:collapse;font-size:14px"><tr><th align="left">Repo</th><th align="left">Status</th><th align="left">Model</th><th align="right">Tokens</th></tr>${items}</table>
<p style="color:#5e5e5e;font-size:12px;margin-top:16px">Metadata only — HALCYX never stores your prompts or code. Change this in Settings › Notifications.</p></div>`;
}

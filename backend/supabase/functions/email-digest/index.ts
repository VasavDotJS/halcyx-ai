import { adminClient, env, HttpError, json, serve } from '../_shared/http.ts';

/**
 * Optional daily/weekly email digest, triggered hourly by pg_cron. Lists task metadata only
 * (repo, status, model, tokens, estimated cost) from task_log. Sends via Resend.
 */
type Row = {
  repo: string;
  status: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  started_at: string;
};

const DAY = 86_400_000;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function render(rows: Row[], period: string): string {
  const total = rows.reduce((a, r) => a + Number(r.cost_usd), 0);
  const items = rows
    .slice(0, 50)
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.repo)}</td><td>${escapeHtml(r.status)}</td><td>${escapeHtml(r.model)}</td><td style="text-align:right">${(
          r.input_tokens + r.output_tokens
        ).toLocaleString('en-US')}</td></tr>`,
    )
    .join('');
  return `<div style="font-family:-apple-system,Segoe UI,sans-serif;color:#171717">
<h2 style="margin:0 0 8px">Your HALCYX ${period} digest</h2>
<p style="color:#5e5e5e;margin:0 0 16px">${rows.length} tasks · ≈ $${total.toFixed(2)} estimated spend</p>
<table cellpadding="6" style="border-collapse:collapse;font-size:14px"><tr><th align="left">Repo</th><th align="left">Status</th><th align="left">Model</th><th align="right">Tokens</th></tr>${items}</table>
<p style="color:#5e5e5e;font-size:12px;margin-top:16px">Metadata only — HALCYX never stores your prompts or code. Change this in Settings › Notifications.</p></div>`;
}

serve(async (req) => {
  if (req.headers.get('x-digest-secret') !== env('DIGEST_SECRET')) throw new HttpError(401, 'unauthorized');
  const db = adminClient();
  const now = Date.now();
  const { data: users, error } = await db.from('user_settings').select('user_id, prefs').in('prefs->>emailDigest', ['daily', 'weekly']);
  if (error) throw new HttpError(500, 'lookup_failed');

  let sent = 0;
  for (const u of users ?? []) {
    const period = (u.prefs as { emailDigest: 'daily' | 'weekly' }).emailDigest;
    const window = period === 'daily' ? DAY : 7 * DAY;
    const { data: last } = await db.from('digest_log').select('last_sent_at').eq('user_id', u.user_id).maybeSingle();
    if (last && now - new Date(last.last_sent_at).getTime() < window - 3_600_000) continue;

    const since = new Date(now - window).toISOString();
    const { data: rows } = await db
      .from('task_log')
      .select('repo, status, model, input_tokens, output_tokens, cost_usd, started_at')
      .eq('user_id', u.user_id)
      .gte('started_at', since)
      .order('started_at', { ascending: false });
    if (!rows?.length) continue;

    const { data: authUser } = await db.auth.admin.getUserById(u.user_id);
    const email = authUser.user?.email;
    if (!email) continue;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env('RESEND_API_KEY')}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: env('DIGEST_FROM'),
        to: [email],
        subject: `HALCYX ${period} digest`,
        html: render(rows as Row[], period),
      }),
    });
    if (res.ok) {
      await db.from('digest_log').upsert({ user_id: u.user_id, last_sent_at: new Date(now).toISOString() });
      sent += 1;
    }
  }
  return json({ sent });
});

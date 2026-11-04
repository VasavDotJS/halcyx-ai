import { adminClient, env, HttpError, json, safeEqual, serve } from '../_shared/http.ts';
import { type DigestPeriod, digestPeriodOf, isDue, mapLimit, render, type Row } from './digest.ts';

/**
 * Optional daily/weekly email digest, triggered hourly by pg_cron. Lists task metadata only
 * (repo, status, model, tokens, estimated cost) from task_log. Sends via Resend.
 *
 * Only users whose stored preference is exactly "daily" or "weekly" are ever mailed: each
 * period is queried explicitly and every row is re-validated before sending. Work is paged
 * and runs with bounded concurrency; anything not reached before the time budget is picked
 * up by the next hourly run (digest_log records who was already sent).
 */
const PAGE = 200;
const CONCURRENCY = 5;
const TIME_BUDGET_MS = 110_000;

serve('email-digest', async (req) => {
  if (!(await safeEqual(req.headers.get('x-digest-secret') ?? '', env('DIGEST_SECRET')))) throw new HttpError(401, 'unauthorized');
  const db = adminClient();
  const started = Date.now();
  const resendKey = env('RESEND_API_KEY');
  const from = env('DIGEST_FROM');
  let sent = 0;
  let skipped = 0;

  const sendOne = async (u: { user_id: string; prefs: unknown }, period: DigestPeriod) => {
    if (digestPeriodOf(u.prefs) !== period) {
      skipped += 1;
      return;
    }
    const { data: last } = await db.from('digest_log').select('last_sent_at').eq('user_id', u.user_id).maybeSingle();
    const now = Date.now();
    if (!isDue(period, last?.last_sent_at ?? null, now)) return;

    const since = new Date(now - (period === 'daily' ? 1 : 7) * 86_400_000).toISOString();
    const { data: rows } = await db
      .from('task_log')
      .select('repo, status, model, input_tokens, output_tokens, cost_usd, started_at')
      .eq('user_id', u.user_id)
      .gte('started_at', since)
      .order('started_at', { ascending: false })
      .limit(50);
    if (!rows?.length) return;

    const { data: authUser } = await db.auth.admin.getUserById(u.user_id);
    const email = authUser.user?.email;
    if (!email) return;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${resendKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [email], subject: `HALCYX ${period} digest`, html: render(rows as Row[], period) }),
    });
    if (res.ok) {
      await db.from('digest_log').upsert({ user_id: u.user_id, last_sent_at: new Date(now).toISOString() });
      sent += 1;
    }
  };

  for (const period of ['daily', 'weekly'] as const) {
    for (let offset = 0; ; offset += PAGE) {
      if (Date.now() - started > TIME_BUDGET_MS) return json({ sent, skipped, partial: true });
      const { data: users, error } = await db
        .from('user_settings')
        .select('user_id, prefs')
        .eq('prefs->>emailDigest', period)
        .order('user_id')
        .range(offset, offset + PAGE - 1);
      if (error) throw new HttpError(500, 'lookup_failed');
      if (!users?.length) break;
      await mapLimit(users, CONCURRENCY, (u) => sendOne(u, period));
      if (users.length < PAGE) break;
    }
  }
  return json({ sent, skipped });
});

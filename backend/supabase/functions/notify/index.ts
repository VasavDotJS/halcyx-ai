import { HttpError, json, rateLimit, readJson, requireUser, serve, userClient } from '../_shared/http.ts';

/**
 * Cross-device push (e.g. the tablet learns that a task started on the phone finished).
 * Metadata only: the notification text is generic and never includes prompts or code.
 * Each (kind, task) is delivered at most once per 10 minutes, and each user is capped at
 * 60 notifications per hour, so retry storms can't fan out duplicate pushes.
 */
const KINDS = {
  task_finished: { title: 'Ready for review', body: (repo: string) => `${repo}: changes are waiting in Review.` },
  task_failed: { title: 'Task stopped', body: (repo: string) => `${repo}: open HALCYX for details.` },
  needs_approval: { title: 'Approval needed', body: (repo: string) => `${repo}: the agent is waiting for you.` },
  workspace_expiring: { title: 'Changes expire soon', body: (repo: string) => `${repo}: review and push within 12 hours.` },
} as const;

type Body = { kind: keyof typeof KINDS; task_id: string; repo: string };

serve('notify', async (req, ctx) => {
  const user = await requireUser(req);
  ctx.userId = user.id;
  const body = await readJson<Body>(req, 1024);
  const kind = Object.hasOwn(KINDS, body.kind) ? KINDS[body.kind] : null;
  if (!kind || !/^[A-Za-z0-9_-]{1,64}$/.test(body.task_id) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(body.repo)) {
    throw new HttpError(400, 'invalid_request');
  }
  try {
    await rateLimit(`notify-event:${user.id}:${body.kind}:${body.task_id}`, 1, 600);
  } catch (e) {
    if (e instanceof HttpError && e.status === 429) return json({ sent: 0, duplicate: true });
    throw e;
  }
  await rateLimit(`notify:${user.id}`, 60, 3600);

  const { data, error } = await userClient(req).from('devices').select('push_token').eq('revoked', false).not('push_token', 'is', null);
  if (error) throw new HttpError(500, 'lookup_failed');
  const messages = (data ?? []).map((d: { push_token: string }) => ({
    to: d.push_token,
    title: kind.title,
    body: kind.body(body.repo),
    data: { route: `/chat/${body.task_id}` },
    sound: null,
  }));
  if (!messages.length) return json({ sent: 0 });
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(messages),
  });
  if (!res.ok) throw new HttpError(502, 'push_failed');
  return json({ sent: messages.length });
});

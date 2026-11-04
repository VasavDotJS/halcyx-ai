import { adminClient, HttpError, json, rateLimit, requireUser, serve } from '../_shared/http.ts';

/**
 * In-app account deletion (App Store guideline 5.1.1(v)). Deleting the auth user cascades
 * to profiles, settings, devices, task_log and digest_log.
 */
serve(
  'delete-account',
  async (req, ctx) => {
    const user = await requireUser(req);
    ctx.userId = user.id;
    await rateLimit(`delete-account:${user.id}`, 5, 3600);
    const { error } = await adminClient().auth.admin.deleteUser(user.id);
    if (error) throw new HttpError(500, 'delete_failed');
    return json({ deleted: true });
  },
  { auditCalls: true },
);

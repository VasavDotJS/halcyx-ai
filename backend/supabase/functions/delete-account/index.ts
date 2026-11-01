import { adminClient, HttpError, json, requireUser, serve } from '../_shared/http.ts';

/**
 * In-app account deletion (App Store guideline 5.1.1(v)). Deleting the auth user cascades
 * to profiles, settings, devices, task_log and digest_log.
 */
serve(async (req) => {
  const user = await requireUser(req);
  const { error } = await adminClient().auth.admin.deleteUser(user.id);
  if (error) throw new HttpError(500, 'delete_failed');
  return json({ deleted: true });
});

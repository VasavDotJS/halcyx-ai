import type { SqlDb } from '@/core/platform/types';

const DAY = 86_400_000;

/**
 * Keeps local data bounded (audit M-6). Pending review work is never touched: only read
 * notifications, timelines of tasks that finished long ago, and usage older than the
 * 13 months the usage screen can show.
 */
export async function pruneLocalData(db: SqlDb, now = Date.now()): Promise<void> {
  await db.transaction(async () => {
    await db.run('DELETE FROM notifications WHERE read = 1 AND created_at < ?', [now - 30 * DAY]);
    await db.run('DELETE FROM notifications WHERE created_at < ?', [now - 90 * DAY]);
    await db.run(
      `DELETE FROM task_events WHERE task_id IN (
         SELECT id FROM tasks
         WHERE status IN ('completed','failed','cancelled','incomplete') AND workspace_id IS NULL AND updated_at < ?)`,
      [now - 30 * DAY],
    );
    await db.run('DELETE FROM usage WHERE at < ?', [now - 400 * DAY]);
  });
}

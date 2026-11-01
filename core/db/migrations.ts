import type { SqlDb } from '@/core/platform/types';

/**
 * Local (on-device) schema. Columns ending in `_enc` hold AES-GCM ciphertext. Nothing here
 * is ever synced to the HALCYX backend except the explicitly metadata-only task log.
 */
const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS workspaces (
     id TEXT PRIMARY KEY, task_id TEXT NOT NULL, repo_full TEXT NOT NULL, provider TEXT NOT NULL,
     status TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
     warned INTEGER NOT NULL DEFAULT 0, meta_enc TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS ws_files (
     id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     path_enc TEXT NOT NULL, change TEXT NOT NULL, size INTEGER NOT NULL, binary INTEGER NOT NULL,
     mode TEXT NOT NULL, decision TEXT NOT NULL DEFAULT 'accepted', rejected_hunks TEXT NOT NULL DEFAULT '[]');
   CREATE INDEX IF NOT EXISTS ws_files_ws ON ws_files(workspace_id);
   CREATE TABLE IF NOT EXISTS push_log (
     id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, repo_full TEXT NOT NULL, branch TEXT NOT NULL,
     commit_sha TEXT, pr_url TEXT, files_count INTEGER NOT NULL, outcome TEXT NOT NULL, at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS tasks (
     id TEXT PRIMARY KEY, title_enc TEXT NOT NULL, repo_full TEXT NOT NULL, provider TEXT NOT NULL,
     model TEXT NOT NULL, effort TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL, handle_json TEXT, request_enc TEXT, workspace_id TEXT, group_id TEXT,
     input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
     cost_usd REAL NOT NULL DEFAULT 0, error TEXT);
   CREATE TABLE IF NOT EXISTS task_events (
     task_id TEXT NOT NULL, seq INTEGER NOT NULL, payload_enc TEXT NOT NULL, PRIMARY KEY (task_id, seq));
   CREATE TABLE IF NOT EXISTS usage (
     id TEXT PRIMARY KEY, task_id TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
     input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cost_usd REAL NOT NULL, at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS queue (
     id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload_enc TEXT NOT NULL, created_at INTEGER NOT NULL,
     attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT);
   CREATE TABLE IF NOT EXISTS prompts (
     id TEXT PRIMARY KEY, title TEXT NOT NULL, body_enc TEXT NOT NULL, created_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS repo_settings (
     repo_full TEXT PRIMARY KEY, provider TEXT, model TEXT, effort TEXT, instructions_enc TEXT);
   CREATE TABLE IF NOT EXISTS sandboxes (
     environment_id TEXT PRIMARY KEY, provider TEXT NOT NULL, repo_full TEXT NOT NULL, last_used_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS notifications (
     id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, kind TEXT NOT NULL,
     task_id TEXT, created_at INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0);`,
];

export async function migrate(db: SqlDb): Promise<void> {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)');
  const row = await db.get<{ v: number }>('SELECT v FROM schema_version LIMIT 1');
  const current = row?.v ?? 0;
  for (let i = current; i < MIGRATIONS.length; i += 1) {
    await db.transaction(async () => {
      await db.exec(MIGRATIONS[i]!);
      await db.run('DELETE FROM schema_version');
      await db.run('INSERT INTO schema_version (v) VALUES (?)', [i + 1]);
    });
  }
}

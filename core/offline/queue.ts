import type { Platform } from '@/core/platform/types';
import { randomId } from '@/core/security/crypto';
import { openLocal, sealLocal } from '@/core/security/dataKey';

export type QueueKind = 'prompt' | 'push';
export type QueuedItem<T = unknown> = { id: string; kind: QueueKind; payload: T; createdAt: number; attempts: number };
export type QueueHandlers = Partial<Record<QueueKind, (payload: unknown) => Promise<void>>>;

const MAX_ATTEMPTS = 5;

/**
 * Offline queue for prompts and pushes. Payloads are sealed with the device data key.
 * Items are processed in order; a failing item is retried later without blocking others.
 */
export class OfflineQueue {
  private flushing = false;

  constructor(
    private readonly p: Platform,
    private readonly now: () => number = Date.now,
  ) {}

  async enqueue(kind: QueueKind, payload: unknown): Promise<string> {
    const id = randomId(8);
    await this.p.db.run('INSERT INTO queue (id, kind, payload_enc, created_at) VALUES (?, ?, ?, ?)', [
      id,
      kind,
      await sealLocal(this.p.secrets, JSON.stringify(payload), `queue:${id}`),
      this.now(),
    ]);
    return id;
  }

  async list(): Promise<QueuedItem[]> {
    const rows = await this.p.db.all<{ id: string; kind: QueueKind; payload_enc: string; created_at: number; attempts: number }>(
      'SELECT * FROM queue ORDER BY created_at ASC',
    );
    const out: QueuedItem[] = [];
    for (const r of rows) {
      out.push({
        id: r.id,
        kind: r.kind,
        payload: JSON.parse(await openLocal(this.p.secrets, r.payload_enc, `queue:${r.id}`)),
        createdAt: r.created_at,
        attempts: r.attempts,
      });
    }
    return out;
  }

  async remove(id: string): Promise<void> {
    await this.p.db.run('DELETE FROM queue WHERE id = ?', [id]);
  }

  async count(): Promise<number> {
    return (await this.p.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM queue'))?.n ?? 0;
  }

  /** Processes queued items. Returns how many succeeded. */
  async flush(handlers: QueueHandlers): Promise<number> {
    if (this.flushing) return 0;
    this.flushing = true;
    let done = 0;
    try {
      for (const item of await this.list()) {
        const handler = handlers[item.kind];
        if (!handler) continue;
        try {
          await handler(item.payload);
          await this.remove(item.id);
          done += 1;
        } catch (e) {
          if (item.attempts + 1 >= MAX_ATTEMPTS) await this.remove(item.id);
          else
            await this.p.db.run('UPDATE queue SET attempts = attempts + 1, last_error = ? WHERE id = ?', [
              String((e as Error).message).slice(0, 200),
              item.id,
            ]);
        }
      }
    } finally {
      this.flushing = false;
    }
    return done;
  }
}

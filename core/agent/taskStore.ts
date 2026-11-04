import { mapLimit } from '@/core/util/concurrency';
import type { Platform } from '@/core/platform/types';
import { openLocal, sealLocal } from '@/core/security/dataKey';
import type { AgentEvent, AgentTaskHandle, AgentTaskRequest, Effort, ProviderId, TaskStatus } from '@/core/types';

export type TaskRecord = {
  id: string;
  title: string;
  repoFull: string;
  provider: ProviderId;
  model: string;
  effort: Effort;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  workspaceId: string | null;
  groupId: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  error: string | null;
};

type Row = {
  id: string;
  title_enc: string;
  repo_full: string;
  provider: ProviderId;
  model: string;
  effort: Effort;
  status: TaskStatus;
  created_at: number;
  updated_at: number;
  handle_json: string | null;
  request_enc: string | null;
  workspace_id: string | null;
  group_id: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  error: string | null;
};

/** Persisted request; the GitHub read token is never stored (re-minted per run). */
export type StoredRequest = Omit<AgentTaskRequest, 'readToken'>;

/** Local task history. Prompts, requests and event payloads are sealed with the device key. */
/** Event batches (≤50 events each) loaded per task; enough for any real task, bounded for runaway ones. */
const MAX_EVENT_BATCHES = 1_000;

export class TaskStore {
  private seq = new Map<string, number>();
  /** Decrypted titles, so history search doesn't decrypt every row on each keystroke. */
  private titles = new Map<string, string>();

  constructor(
    private readonly p: Platform,
    private readonly now: () => number = Date.now,
  ) {}

  private async title(r: Row): Promise<string> {
    const hit = this.titles.get(r.id);
    if (hit !== undefined) return hit;
    const t = await openLocal(this.p.secrets, r.title_enc, `task:${r.id}:title`);
    this.titles.set(r.id, t);
    return t;
  }

  private async toRecord(r: Row): Promise<TaskRecord> {
    return {
      id: r.id,
      title: await this.title(r),
      repoFull: r.repo_full,
      provider: r.provider,
      model: r.model,
      effort: r.effort,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      workspaceId: r.workspace_id,
      groupId: r.group_id,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      costUsd: r.cost_usd,
      error: r.error,
    };
  }

  async create(req: AgentTaskRequest, groupId: string | null): Promise<void> {
    const stored: StoredRequest = { ...req };
    delete (stored as Partial<AgentTaskRequest>).readToken;
    const t = this.now();
    await this.p.db.run(
      `INSERT INTO tasks (id, title_enc, repo_full, provider, model, effort, status, created_at, updated_at, request_enc, group_id)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
      [
        req.taskId,
        await sealLocal(this.p.secrets, req.prompt.slice(0, 200), `task:${req.taskId}:title`),
        `${req.repo.owner}/${req.repo.name}`,
        req.provider,
        req.model,
        req.effort,
        t,
        t,
        await sealLocal(this.p.secrets, JSON.stringify(stored), `task:${req.taskId}:req`),
        groupId,
      ],
    );
  }

  async get(id: string): Promise<TaskRecord | null> {
    const r = await this.p.db.get<Row>('SELECT * FROM tasks WHERE id = ?', [id]);
    return r ? this.toRecord(r) : null;
  }

  async request(id: string): Promise<StoredRequest> {
    const r = await this.p.db.get<{ request_enc: string }>('SELECT request_enc FROM tasks WHERE id = ?', [id]);
    if (!r?.request_enc) throw new Error('Task request missing');
    return JSON.parse(await openLocal(this.p.secrets, r.request_enc, `task:${id}:req`)) as StoredRequest;
  }

  async saveRequest(id: string, req: StoredRequest): Promise<void> {
    const clean = { ...req } as Partial<AgentTaskRequest>;
    delete clean.readToken;
    await this.p.db.run('UPDATE tasks SET request_enc = ? WHERE id = ?', [
      await sealLocal(this.p.secrets, JSON.stringify(clean), `task:${id}:req`),
      id,
    ]);
  }

  async handle(id: string): Promise<AgentTaskHandle | null> {
    const r = await this.p.db.get<{ handle_json: string | null }>('SELECT handle_json FROM tasks WHERE id = ?', [id]);
    return r?.handle_json ? (JSON.parse(r.handle_json) as AgentTaskHandle) : null;
  }

  /** Handles hold only remote IDs and opaque provider state — never keys or file contents. */
  async saveHandle(id: string, handle: AgentTaskHandle): Promise<void> {
    await this.p.db.run('UPDATE tasks SET handle_json = ?, updated_at = ? WHERE id = ?', [JSON.stringify(handle), this.now(), id]);
  }

  async setStatus(id: string, status: TaskStatus, error: string | null = null): Promise<void> {
    await this.p.db.run('UPDATE tasks SET status = ?, error = ?, updated_at = ? WHERE id = ?', [status, error, this.now(), id]);
  }

  async setWorkspace(id: string, workspaceId: string | null): Promise<void> {
    await this.p.db.run('UPDATE tasks SET workspace_id = ? WHERE id = ?', [workspaceId, id]);
  }

  async list(limit = 200): Promise<TaskRecord[]> {
    const rows = await this.p.db.all<Row>('SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?', [limit]);
    return Promise.all(rows.map((r) => this.toRecord(r)));
  }

  async byGroup(groupId: string): Promise<TaskRecord[]> {
    const rows = await this.p.db.all<Row>('SELECT * FROM tasks WHERE group_id = ? ORDER BY created_at', [groupId]);
    return Promise.all(rows.map((r) => this.toRecord(r)));
  }

  async active(): Promise<TaskRecord[]> {
    const rows = await this.p.db.all<Row>(
      `SELECT * FROM tasks WHERE status IN ('queued','running','awaiting_approval') ORDER BY created_at`,
    );
    return Promise.all(rows.map((r) => this.toRecord(r)));
  }

  /** Search over titles and repo names. Titles are decrypted once and cached; callers debounce input. */
  async search(query: string): Promise<TaskRecord[]> {
    const q = query.trim().toLowerCase();
    const all = await this.list(500);
    return q ? all.filter((t) => t.title.toLowerCase().includes(q) || t.repoFull.toLowerCase().includes(q)) : all;
  }

  async appendEvents(id: string, events: AgentEvent[]): Promise<void> {
    if (!events.length) return;
    let seq = this.seq.get(id);
    if (seq === undefined) {
      seq = (await this.p.db.get<{ m: number | null }>('SELECT MAX(seq) AS m FROM task_events WHERE task_id = ?', [id]))?.m ?? 0;
    }
    seq += 1;
    await this.p.db.run('INSERT INTO task_events (task_id, seq, payload_enc) VALUES (?, ?, ?)', [
      id,
      seq,
      await sealLocal(this.p.secrets, JSON.stringify(events), `task:${id}:ev:${seq}`),
    ]);
    this.seq.set(id, seq);
  }

  async events(id: string): Promise<AgentEvent[]> {
    const rows = await this.p.db.all<{ seq: number; payload_enc: string }>(
      'SELECT seq, payload_enc FROM task_events WHERE task_id = ? ORDER BY seq DESC LIMIT ?',
      [id, MAX_EVENT_BATCHES],
    );
    rows.reverse();
    const batches = await mapLimit(rows, 8, async (r) => {
      try {
        return JSON.parse(await openLocal(this.p.secrets, r.payload_enc, `task:${id}:ev:${r.seq}`)) as AgentEvent[];
      } catch {
        return [] as AgentEvent[];
      }
    });
    return batches.flat();
  }

  async checkpoint(id: string): Promise<string | null> {
    const r = await this.p.db.get<{ value: string }>('SELECT value FROM kv WHERE key = ?', [`checkpoint.${id}`]);
    return r ? openLocal(this.p.secrets, r.value, `task:${id}:cp`) : null;
  }

  async saveCheckpoint(id: string, json: string): Promise<void> {
    await this.p.db.run('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', [
      `checkpoint.${id}`,
      await sealLocal(this.p.secrets, json, `task:${id}:cp`),
    ]);
  }

  async clearCheckpoint(id: string): Promise<void> {
    await this.p.db.run('DELETE FROM kv WHERE key = ?', [`checkpoint.${id}`]);
  }
}

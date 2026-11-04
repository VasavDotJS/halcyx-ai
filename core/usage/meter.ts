import type { SqlDb } from '@/core/platform/types';
import { randomId } from '@/core/security/crypto';
import type { ProviderId } from '@/core/types';

export type BudgetSettings = { monthlyBudgetUsd: number | null; alertAtPct: number; hardCap: boolean };
export type BudgetState = { state: 'ok' | 'alert' | 'capped'; spentUsd: number; remainingUsd: number | null; pct: number | null };

export function monthStart(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export function evaluateBudget(b: BudgetSettings, spentUsd: number): BudgetState {
  if (!b.monthlyBudgetUsd || b.monthlyBudgetUsd <= 0) return { state: 'ok', spentUsd, remainingUsd: null, pct: null };
  const pct = (spentUsd / b.monthlyBudgetUsd) * 100;
  const remainingUsd = Math.max(0, b.monthlyBudgetUsd - spentUsd);
  if (b.hardCap && spentUsd >= b.monthlyBudgetUsd) return { state: 'capped', spentUsd, remainingUsd: 0, pct };
  if (pct >= b.alertAtPct) return { state: 'alert', spentUsd, remainingUsd, pct };
  return { state: 'ok', spentUsd, remainingUsd, pct };
}

export class UsageMeter {
  constructor(
    private readonly db: SqlDb,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records usage and updates the task totals atomically, so spend can't drift. */
  async record(e: { taskId: string; provider: ProviderId; model: string; inputTokens: number; outputTokens: number; costUsd: number }) {
    await this.db.transaction(async () => {
      await this.db.run(
        'INSERT INTO usage (id, task_id, provider, model, input_tokens, output_tokens, cost_usd, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [randomId(8), e.taskId, e.provider, e.model, e.inputTokens, e.outputTokens, e.costUsd, this.now()],
      );
      await this.db.run(
        'UPDATE tasks SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, cost_usd = cost_usd + ? WHERE id = ?',
        [e.inputTokens, e.outputTokens, e.costUsd, e.taskId],
      );
    });
  }

  async monthSpend(): Promise<number> {
    const row = await this.db.get<{ s: number | null }>('SELECT SUM(cost_usd) AS s FROM usage WHERE at >= ?', [monthStart(this.now())]);
    return row?.s ?? 0;
  }

  async byProvider(since = monthStart(this.now())) {
    return this.db.all<{ provider: ProviderId; input: number; output: number; usd: number; tasks: number }>(
      `SELECT provider, SUM(input_tokens) AS input, SUM(output_tokens) AS output, SUM(cost_usd) AS usd,
              COUNT(DISTINCT task_id) AS tasks FROM usage WHERE at >= ? GROUP BY provider ORDER BY usd DESC`,
      [since],
    );
  }

  async byMonth(months = 6) {
    const since = new Date(new Date(this.now()).getFullYear(), new Date(this.now()).getMonth() - (months - 1), 1).getTime();
    const rows = await this.db.all<{ at: number; cost_usd: number }>('SELECT at, cost_usd FROM usage WHERE at >= ?', [since]);
    const buckets = new Map<string, number>();
    for (let i = months - 1; i >= 0; i -= 1) {
      const d = new Date(new Date(this.now()).getFullYear(), new Date(this.now()).getMonth() - i, 1);
      buckets.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, 0);
    }
    for (const r of rows) {
      const d = new Date(r.at);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      buckets.set(k, (buckets.get(k) ?? 0) + r.cost_usd);
    }
    return [...buckets].map(([month, usd]) => ({ month, usd }));
  }
}

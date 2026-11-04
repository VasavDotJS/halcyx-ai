import { migrate } from '@/core/db/migrations';
import { groupReclaimable, reclaimableRoot, remoteCleanCommand } from '@/core/cleaner/patterns';
import { OfflineQueue } from '@/core/offline/queue';
import { assertMetadataOnly } from '@/core/backend/metadata';
import { extractKey, looksLikeKey, maskKey } from '@/core/security/keyFormat';
import { scrubString } from '@/core/security/scrub';
import { scanChanges } from '@/core/security/secretScanner';
import { evaluateBudget, UsageMeter } from '@/core/usage/meter';
import { createTestPlatform } from './helpers/platform';

describe('storage cleaner patterns', () => {
  it('finds dependency roots but never source files', () => {
    expect(reclaimableRoot('web/node_modules/react/index.js')).toBe('web/node_modules');
    expect(reclaimableRoot('api/__pycache__/x.pyc')).toBe('api/__pycache__');
    expect(reclaimableRoot('.yarn/cache/pkg.zip')).toBe('.yarn/cache');
    expect(reclaimableRoot('src/build.ts')).toBeNull();
    expect(reclaimableRoot('dist')).toBeNull();
  });

  it('groups sizes per root', () => {
    const g = groupReclaimable([
      { path: 'node_modules/a/x.js', bytes: 100 },
      { path: 'node_modules/b/y.js', bytes: 50 },
      { path: 'src/index.ts', bytes: 999 },
    ]);
    expect(g).toEqual([{ root: 'node_modules', bytes: 150, files: 2 }]);
  });

  it('only removes git-ignored files remotely', () => {
    expect(remoteCleanCommand('/workspace/repo', ['node_modules'])).toBe("cd '/workspace/repo' && git clean -fdX -- 'node_modules'");
  });
});

describe('offline queue', () => {
  it('stores payloads encrypted and flushes in order with retries', async () => {
    const p = createTestPlatform();
    await migrate(p.db);
    const q = new OfflineQueue(p);
    await q.enqueue('prompt', { prompt: 'PRIVATE_PROMPT_TEXT' });
    await q.enqueue('push', { workspaceId: 'w1' });
    const raw = JSON.stringify(await p.db.all('SELECT * FROM queue'));
    expect(raw).not.toContain('PRIVATE_PROMPT_TEXT');

    const seen: unknown[] = [];
    let fail = true;
    const handlers = {
      prompt: async (x: unknown) => void seen.push(x),
      push: async () => {
        if (fail) throw new Error('offline');
      },
    };
    expect(await q.flush(handlers)).toBe(1);
    expect(await q.count()).toBe(1);
    fail = false;
    expect(await q.flush(handlers)).toBe(1);
    expect(await q.count()).toBe(0);
    expect(seen).toEqual([{ prompt: 'PRIVATE_PROMPT_TEXT' }]);
  });
});

describe('usage & budget', () => {
  it('alerts and hard-caps', async () => {
    expect(evaluateBudget({ monthlyBudgetUsd: 10, alertAtPct: 80, hardCap: true }, 5).state).toBe('ok');
    expect(evaluateBudget({ monthlyBudgetUsd: 10, alertAtPct: 80, hardCap: true }, 8.5).state).toBe('alert');
    expect(evaluateBudget({ monthlyBudgetUsd: 10, alertAtPct: 80, hardCap: true }, 10).state).toBe('capped');
    expect(evaluateBudget({ monthlyBudgetUsd: 10, alertAtPct: 80, hardCap: false }, 12).state).toBe('alert');
    expect(evaluateBudget({ monthlyBudgetUsd: null, alertAtPct: 80, hardCap: true }, 99).state).toBe('ok');
  });

  it('aggregates spend per month and provider', async () => {
    const p = createTestPlatform();
    await migrate(p.db);
    const m = new UsageMeter(p.db, () => new Date(2026, 10, 15).getTime());
    await m.record({ taskId: 't', provider: 'gemini', model: 'gemini-4-argon', inputTokens: 1e6, outputTokens: 1e5, costUsd: 3 });
    await m.record({ taskId: 't2', provider: 'openai', model: 'gpt-6.1-sol', inputTokens: 10, outputTokens: 10, costUsd: 1 });
    expect(await m.monthSpend()).toBe(4);
    expect((await m.byProvider())[0]).toMatchObject({ provider: 'gemini', usd: 3, tasks: 1 });
    expect((await m.byMonth(2)).map((x) => x.usd)).toEqual([0, 4]);
  });
});

describe('key handling', () => {
  it('masks keys like the spec', () => {
    expect(maskKey('AIzaSyD4kq9Lr7Hc2Vbn5Xw1Pq8Zt6Ym3Ja09xQ')).toBe('AIza••••9xQ');
    expect(maskKey('sk-ant-api03-abcdefghijklmnopqrstuvwxyz')).toBe('sk-ant-••••xyz');
  });

  it('detects a Gemini key inside clipboard text', () => {
    expect(extractKey('gemini', '  "AIzaSyD4kq9Lr7Hc2Vbn5Xw1Pq8Zt6Ym3Ja0Ks9",\n')).toBe('AIzaSyD4kq9Lr7Hc2Vbn5Xw1Pq8Zt6Ym3Ja0Ks9');
    expect(extractKey('gemini', 'hello world')).toBeNull();
  });
});

describe('Google keys in both formats', () => {
  const AQ = 'AQ.Ab8RN6KxQ2mV7pL9tZ4wY1cB3dF5gH8jK0nM2qR4sT6uW8yA';
  it('accepts, masks and extracts the newer "AQ." keys', () => {
    expect(looksLikeKey('gemini', AQ)).toBe(true);
    expect(looksLikeKey('gemini', 'AQ.short')).toBe(false);
    expect(maskKey(AQ)).toBe('AQ.••••8yA');
    expect(extractKey('gemini', `  "${AQ}"\n`)).toBe(AQ);
  });
  it('treats them as secrets everywhere (scanner, scrubber, backend guard)', () => {
    expect(scrubString(`key=${AQ}`)).not.toContain(AQ);
    expect(scanChanges([{ path: 'src/config.ts', text: `const k = "${AQ}";` }]).length).toBeGreaterThan(0);
    expect(() => assertMetadataOnly('task_log', { task_id: 'x', repo: 'o/r', branch: AQ })).toThrow();
  });
});

import { migrate } from '@/core/db/migrations';
import { pruneLocalData } from '@/core/db/retention';
import { reportError, setErrorSink } from '@/core/monitoring/report';
import { scrubEvent } from '@/core/monitoring/scrubEvent';
import { mapLimit } from '@/core/util/concurrency';
import { applyHunkDecisions, computeHunks } from '@/core/workspace/diff';
import { createTestPlatform } from './helpers/platform';

const GOOGLE_KEY = 'AIzaSyD4kq9Lr7Hc2Vbn5Xw1Pq8Zt6Ym3Ja0Ks9';

describe('M-12: crash reports carry no source lines', () => {
  it('drops frame context and locals, and scrubs messages', () => {
    const event = scrubEvent({
      message: `failed with ${GOOGLE_KEY}`,
      exception: {
        values: [
          {
            value: `bad key ${GOOGLE_KEY}`,
            stacktrace: {
              frames: [
                {
                  filename: 'app.js',
                  lineno: 3,
                  context_line: `const key = "${GOOGLE_KEY}";`,
                  pre_context: ['secret()'],
                  post_context: ['x'],
                  vars: { k: GOOGLE_KEY },
                },
              ],
            },
          },
        ],
      },
      threads: { values: [{ stacktrace: { frames: [{ context_line: 'const db = connect();' }] } }] },
      request: { data: 'body' },
    });
    const json = JSON.stringify(event);
    expect(json).not.toContain(GOOGLE_KEY);
    expect(json).not.toContain('context_line');
    expect(json).not.toContain('connect()');
    expect(event.request).toBeUndefined();
    expect(event.exception!.values![0]!.stacktrace!.frames![0]).toEqual({ filename: 'app.js', lineno: 3 });
  });
});

describe('M-3: background failures are reported, scrubbed', () => {
  it('routes errors to the sink without leaking secrets', () => {
    const seen: string[] = [];
    setErrorSink((where, message) => seen.push(`${where}|${message}`));
    reportError('notify.otherDevices', new Error(`401 for ${GOOGLE_KEY}`));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/^notify\.otherDevices\|Error: 401 for /);
    expect(seen[0]).not.toContain(GOOGLE_KEY);
    setErrorSink(() => {
      throw new Error('sink down');
    });
    expect(() => reportError('x', 'y')).not.toThrow();
  });
});

describe('M-4/M-5: performance paths', () => {
  it('diffs a large file with many hunks in linear time and round-trips decisions', () => {
    const old = Array.from({ length: 20_000 }, (_, i) => `line ${i}`).join('\n');
    const next = old
      .split('\n')
      .map((l, i) => (i % 40 === 0 ? `${l} changed` : l))
      .join('\n');
    const t0 = Date.now();
    const hunks = computeHunks(old, next);
    expect(Date.now() - t0).toBeLessThan(3_000);
    expect(hunks.length).toBe(500);
    expect(applyHunkDecisions(old, next, new Set())).toBe(next);
    expect(applyHunkDecisions(old, next, new Set(hunks.map((h) => h.index)))).toBe(old);
  });

  it('mapLimit keeps order and bounds concurrency', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3], 2, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, n));
      inFlight -= 1;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30]);
    expect(peak).toBe(2);
  });
});

describe('M-6: local data is pruned without touching pending work', () => {
  it('prunes old finished timelines, read notifications and old usage only', async () => {
    const p = createTestPlatform();
    await migrate(p.db);
    const now = Date.parse('2026-11-04T00:00:00Z');
    const day = 86_400_000;
    const task = (id: string, status: string, ws: string | null, updated: number) =>
      p.db.run(
        `INSERT INTO tasks (id, title_enc, repo_full, provider, model, effort, status, created_at, updated_at, workspace_id, request_enc)
         VALUES (?, 't', 'o/r', 'gemini', 'm', 'low', ?, ?, ?, ?, 'r')`,
        [id, status, updated, updated, ws],
      );
    await task('old-done', 'completed', null, now - 60 * day);
    await task('old-pending-review', 'completed', 'ws1', now - 60 * day);
    await task('recent-done', 'completed', null, now - 2 * day);
    for (const id of ['old-done', 'old-pending-review', 'recent-done']) {
      await p.db.run('INSERT INTO task_events (task_id, seq, payload_enc) VALUES (?, 1, ?)', [id, 'x']);
    }
    await p.db.run(`INSERT INTO notifications (id, title, body, kind, created_at, read) VALUES ('n1','t','b','k',?,1)`, [now - 40 * day]);
    await p.db.run(`INSERT INTO notifications (id, title, body, kind, created_at, read) VALUES ('n2','t','b','k',?,0)`, [now - 40 * day]);
    await p.db.run(
      `INSERT INTO usage (id, task_id, provider, model, input_tokens, output_tokens, cost_usd, at) VALUES ('u1','t','gemini','m',1,1,1,?), ('u2','t','gemini','m',1,1,1,?)`,
      [now - 500 * day, now - 10 * day],
    );

    await pruneLocalData(p.db, now);

    const events = (await p.db.all<{ task_id: string }>('SELECT task_id FROM task_events ORDER BY task_id')).map((r) => r.task_id);
    expect(events).toEqual(['old-pending-review', 'recent-done']);
    expect((await p.db.all<{ id: string }>('SELECT id FROM notifications')).map((r) => r.id)).toEqual(['n2']);
    expect((await p.db.all<{ id: string }>('SELECT id FROM usage')).map((r) => r.id)).toEqual(['u2']);
  });
});

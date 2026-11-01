import { applyHunkDecisions, computeHunks, diffStats, isBinary, toSplitRows } from '@/core/workspace/diff';
import { readTar, writeTar } from '@/core/workspace/tar';

const base = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
const head = base.replace('line 3', 'line three').replace('line 25', 'line twenty-five\nextra');

describe('diff engine', () => {
  it('splits distant changes into separate hunks', () => {
    const hunks = computeHunks(base, head);
    expect(hunks).toHaveLength(2);
    expect(diffStats(hunks)).toEqual({ additions: 3, deletions: 2 });
    expect(hunks[0]!.oldStart).toBe(1);
  });

  it('reconstructs exactly when everything is accepted or rejected', () => {
    expect(applyHunkDecisions(base, head, new Set())).toBe(head);
    expect(applyHunkDecisions(base, head, new Set([0, 1]))).toBe(base);
  });

  it('applies a single hunk', () => {
    const merged = applyHunkDecisions(base, head, new Set([1]));
    expect(merged).toContain('line three');
    expect(merged).toContain('line 25');
    expect(merged).not.toContain('extra');
  });

  it('preserves trailing newlines', () => {
    expect(applyHunkDecisions('a\n', 'a\nb\n', new Set())).toBe('a\nb\n');
    expect(applyHunkDecisions('a\n', 'a\nb\n', new Set([0]))).toBe('a\n');
  });

  it('pairs lines for the split view', () => {
    const rows = toSplitRows(computeHunks('a\nb\nc', 'a\nB\nc')[0]!);
    expect(rows.find((r) => r.left?.text === 'b')?.right?.text).toBe('B');
  });

  it('detects binary content', () => {
    expect(isBinary(new Uint8Array([1, 0, 2]))).toBe(true);
    expect(isBinary(new TextEncoder().encode('text'))).toBe(false);
  });
});

describe('tar reader', () => {
  it('round-trips files', () => {
    const files = [
      { path: 'src/a.ts', bytes: new TextEncoder().encode('export {}\n') },
      { path: 'empty.txt', bytes: new Uint8Array() },
    ];
    expect(readTar(writeTar(files)).map((e) => [e.path, e.bytes.length])).toEqual([
      ['src/a.ts', 10],
      ['empty.txt', 0],
    ]);
  });
});

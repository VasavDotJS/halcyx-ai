import { diffArrays } from 'diff';

export type DiffLine = { kind: ' ' | '+' | '-'; text: string; oldNo: number | null; newNo: number | null };
export type Hunk = {
  index: number;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
};

type Op = DiffLine & { hunk: number };

function toOps(oldText: string, newText: string): Op[] {
  const parts = diffArrays(oldText.split('\n'), newText.split('\n'));
  const ops: Op[] = [];
  let o = 1;
  let n = 1;
  for (const part of parts) {
    for (const text of part.value) {
      if (part.added) ops.push({ kind: '+', text, oldNo: null, newNo: n++, hunk: -1 });
      else if (part.removed) ops.push({ kind: '-', text, oldNo: o++, newNo: null, hunk: -1 });
      else ops.push({ kind: ' ', text, oldNo: o++, newNo: n++, hunk: -1 });
    }
  }
  return ops;
}

/** Groups changed lines into hunks with `context` lines of surrounding context. */
function assignHunks(ops: Op[], context: number): Hunk[] {
  const hunks: Hunk[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i]!.kind === ' ') {
      i += 1;
      continue;
    }
    let start = Math.max(0, i - context);
    if (hunks.length) {
      const prev = hunks[hunks.length - 1]!;
      const prevEnd = ops.indexOf(prev.lines[prev.lines.length - 1] as Op) + 1;
      start = Math.max(start, prevEnd);
    }
    let end = i;
    let gap = 0;
    for (let j = i; j < ops.length; j += 1) {
      if (ops[j]!.kind === ' ') {
        gap += 1;
        if (gap > context * 2) break;
      } else {
        gap = 0;
        end = j;
      }
    }
    const stop = Math.min(ops.length, end + 1 + context);
    const index = hunks.length;
    const lines = ops.slice(start, stop);
    for (const l of lines) if (l.kind !== ' ') l.hunk = index;
    const firstOld = lines.find((l) => l.oldNo !== null)?.oldNo ?? 0;
    const firstNew = lines.find((l) => l.newNo !== null)?.newNo ?? 0;
    hunks.push({
      index,
      oldStart: firstOld,
      newStart: firstNew,
      oldLines: lines.filter((l) => l.kind !== '+').length,
      newLines: lines.filter((l) => l.kind !== '-').length,
      lines,
    });
    i = stop;
  }
  return hunks;
}

export function computeHunks(oldText: string, newText: string, context = 3): Hunk[] {
  return assignHunks(toOps(oldText, newText), context);
}

/**
 * Builds the final file content: accepted hunks take the new lines, rejected hunks keep the
 * old ones. With nothing rejected this returns `newText` exactly; with everything rejected,
 * `oldText` exactly.
 */
export function applyHunkDecisions(oldText: string, newText: string, rejected: ReadonlySet<number>, context = 3): string {
  const ops = toOps(oldText, newText);
  assignHunks(ops, context);
  const out: string[] = [];
  for (const op of ops) {
    if (op.kind === ' ') out.push(op.text);
    else if (op.kind === '+' && !rejected.has(op.hunk)) out.push(op.text);
    else if (op.kind === '-' && rejected.has(op.hunk)) out.push(op.text);
  }
  return out.join('\n');
}

export type SplitRow = { left: DiffLine | null; right: DiffLine | null };

/** Pairs removed/added runs side by side for the split view. */
export function toSplitRows(hunk: Hunk): SplitRow[] {
  const rows: SplitRow[] = [];
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];
  const flush = () => {
    const n = Math.max(dels.length, adds.length);
    for (let k = 0; k < n; k += 1) rows.push({ left: dels[k] ?? null, right: adds[k] ?? null });
    dels = [];
    adds = [];
  };
  for (const line of hunk.lines) {
    if (line.kind === '-') dels.push(line);
    else if (line.kind === '+') adds.push(line);
    else {
      flush();
      rows.push({ left: line, right: line });
    }
  }
  flush();
  return rows;
}

export function isBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8000);
  for (let i = 0; i < n; i += 1) if (bytes[i] === 0) return true;
  return false;
}

export function diffStats(hunks: Hunk[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const h of hunks)
    for (const l of h.lines) {
      if (l.kind === '+') additions += 1;
      else if (l.kind === '-') deletions += 1;
    }
  return { additions, deletions };
}

/**
 * Minimal POSIX/ustar reader (uncompressed) with GNU long-name and PAX path support.
 * Used to unpack the change archive the sandbox hands back.
 */
export type TarEntry = { path: string; bytes: Uint8Array };

const BLOCK = 512;
const decoder = new TextDecoder();

function str(buf: Uint8Array, off: number, len: number): string {
  let end = off;
  while (end < off + len && buf[end] !== 0) end += 1;
  return decoder.decode(buf.subarray(off, end));
}

function octal(buf: Uint8Array, off: number, len: number): number {
  const s = str(buf, off, len).trim();
  return s ? parseInt(s, 8) : 0;
}

function parsePax(data: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  const text = decoder.decode(data);
  let i = 0;
  while (i < text.length) {
    const sp = text.indexOf(' ', i);
    if (sp < 0) break;
    const len = parseInt(text.slice(i, sp), 10);
    if (!len) break;
    const record = text.slice(sp + 1, i + len - 1);
    const eq = record.indexOf('=');
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    i += len;
  }
  return out;
}

export function readTar(buf: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let off = 0;
  let longName: string | null = null;
  let paxPath: string | null = null;
  while (off + BLOCK <= buf.length) {
    const header = buf.subarray(off, off + BLOCK);
    if (header.every((b) => b === 0)) break;
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const dataStart = off + BLOCK;
    const data = buf.subarray(dataStart, dataStart + size);
    off = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (type === 'L') {
      longName = str(data, 0, data.length);
      continue;
    }
    if (type === 'x') {
      paxPath = parsePax(data).path ?? null;
      continue;
    }
    if (type === 'g') continue;

    const prefix = str(header, 345, 155);
    const name = str(header, 0, 100);
    const path = paxPath ?? longName ?? (prefix ? `${prefix}/${name}` : name);
    longName = null;
    paxPath = null;
    if (type === '0' || type === '\0' || type === '7') {
      entries.push({ path: path.replace(/^\.\//, ''), bytes: data.slice() });
    }
  }
  return entries;
}

/** Writes a ustar archive (used by tests and by the cleaner's remote manifest fixtures). */
export function writeTar(entries: TarEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const blocks: Uint8Array[] = [];
  for (const e of entries) {
    const h = new Uint8Array(BLOCK);
    const name = enc.encode(e.path);
    if (name.length > 100) throw new Error('writeTar supports paths up to 100 bytes');
    h.set(name, 0);
    const field = (off: number, len: number, value: string) => h.set(enc.encode(value.padStart(len - 1, '0')), off);
    field(100, 8, '644');
    field(108, 8, '0');
    field(116, 8, '0');
    field(124, 12, e.bytes.length.toString(8));
    field(136, 12, '0');
    h[156] = 48;
    h.set(enc.encode('ustar\x0000'), 257);
    for (let i = 148; i < 156; i += 1) h[i] = 32;
    const sum = h.reduce((a, b) => a + b, 0);
    h.set(enc.encode(`${sum.toString(8).padStart(6, '0')}\0 `), 148);
    blocks.push(h);
    const padded = new Uint8Array(Math.ceil(e.bytes.length / BLOCK) * BLOCK);
    padded.set(e.bytes);
    blocks.push(padded);
  }
  blocks.push(new Uint8Array(BLOCK * 2));
  const total = blocks.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const b of blocks) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}

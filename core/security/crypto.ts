/**
 * AES-256-GCM helpers on top of WebCrypto (`crypto.subtle`). On iOS/Android the global is
 * provided by react-native-quick-crypto (installed in core/security/installCrypto.ts); on
 * web and in Node tests it is native.
 */

const IV_BYTES = 12;
const VERSION = 1;

/** Narrows to an ArrayBuffer-backed view, as WebCrypto's BufferSource requires. */
export function bufferSource(u: Uint8Array): Uint8Array<ArrayBuffer> {
  return u.buffer instanceof ArrayBuffer ? (u as Uint8Array<ArrayBuffer>) : new Uint8Array(u);
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('WebCrypto is unavailable; call installCrypto() at startup.');
  return s;
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function randomId(bytes = 16): string {
  return toHex(randomBytes(bytes));
}

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64[a >> 2]! + B64[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    out += c === undefined ? '=' : B64[c & 63]!;
  }
  return out;
}

export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64.indexOf(clean[i]!) << 18) |
      (B64.indexOf(clean[i + 1] ?? 'A') << 12) |
      ((clean[i + 2] ? B64.indexOf(clean[i + 2]!) : 0) << 6) |
      (clean[i + 3] ? B64.indexOf(clean[i + 3]!) : 0);
    out[o++] = (n >> 16) & 255;
    if (clean[i + 2]) out[o++] = (n >> 8) & 255;
    if (clean[i + 3]) out[o++] = n & 255;
  }
  return out.slice(0, o);
}

export const utf8 = {
  encode: (s: string) => new TextEncoder().encode(s),
  decode: (b: Uint8Array) => new TextDecoder().decode(b),
};

/** Generates a fresh 256-bit key, returned as base64 for storage in the OS keystore. */
export function generateKeyMaterial(): string {
  return toBase64(randomBytes(32));
}

async function importKey(material: string): Promise<CryptoKey> {
  const raw = fromBase64(material);
  if (raw.length !== 32) throw new Error('Key material must be 256 bits');
  return subtle().importKey('raw', bufferSource(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Sealed format: [version:1][iv:12][ciphertext+tag]. `aad` binds the blob to its context. */
export async function seal(material: string, plaintext: Uint8Array, aad: string): Promise<Uint8Array> {
  const iv = randomBytes(IV_BYTES);
  const key = await importKey(material);
  const ct = new Uint8Array(
    await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(aad), tagLength: 128 }, key, bufferSource(plaintext)),
  );
  const out = new Uint8Array(1 + IV_BYTES + ct.length);
  out[0] = VERSION;
  out.set(iv, 1);
  out.set(ct, 1 + IV_BYTES);
  return out;
}

export async function open(material: string, sealed: Uint8Array, aad: string): Promise<Uint8Array> {
  if (sealed[0] !== VERSION) throw new Error('Unsupported ciphertext version');
  const iv = bufferSource(sealed.slice(1, 1 + IV_BYTES));
  const key = await importKey(material);
  const pt = await subtle().decrypt(
    { name: 'AES-GCM', iv, additionalData: utf8.encode(aad), tagLength: 128 },
    key,
    bufferSource(sealed.slice(1 + IV_BYTES)),
  );
  return new Uint8Array(pt);
}

export async function sealText(material: string, text: string, aad: string): Promise<string> {
  return toBase64(await seal(material, utf8.encode(text), aad));
}

export async function openText(material: string, sealedB64: string, aad: string): Promise<string> {
  return utf8.decode(await open(material, fromBase64(sealedB64), aad));
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? utf8.encode(data) : data;
  return toHex(new Uint8Array(await subtle().digest('SHA-256', bufferSource(bytes))));
}

/** Git blob object id: sha1("blob <len>\0" + content). Lets us diff without downloading base files. */
export async function gitBlobSha(content: Uint8Array): Promise<string> {
  const header = utf8.encode(`blob ${content.length}\0`);
  const buf = new Uint8Array(header.length + content.length);
  buf.set(header, 0);
  buf.set(content, header.length);
  return toHex(new Uint8Array(await subtle().digest('SHA-1', buf)));
}

/** PKCE helpers (RFC 7636) for GitHub OAuth. */
export function base64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64Url(randomBytes(32));
  const digest = new Uint8Array(await subtle().digest('SHA-256', utf8.encode(verifier)));
  return { verifier, challenge: base64Url(digest) };
}

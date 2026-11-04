import type { KeyStatus } from '@/core/types';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: Exclude<KeyStatus, 'valid' | 'unknown'> | 'server' | 'bad_request',
  ) {
    super(message);
  }
}

export function classify(status: number, bodyText: string): ProviderError['kind'] {
  if (status === 401 || status === 403 || /API_KEY_INVALID|invalid[_ ]api[_ ]key|authentication/i.test(bodyText)) return 'invalid';
  if (status === 429 || /RESOURCE_EXHAUSTED|quota|insufficient_quota|rate.?limit/i.test(bodyText)) return 'quota_exceeded';
  if (status >= 500) return 'server';
  return 'bad_request';
}

/** Short, user-safe error text: provider messages never echo the key, but we cap length anyway. */
function errorMessage(bodyText: string, status: number): string {
  try {
    const j = JSON.parse(bodyText) as { error?: { message?: string } | string; message?: string };
    const m = typeof j.error === 'string' ? j.error : (j.error?.message ?? j.message);
    if (m) return m.slice(0, 300);
  } catch {
    /* not JSON */
  }
  return `Request failed (${status})`;
}

/** Requests without their own abort signal (key checks, one-off calls) give up after this long. */
export const DEFAULT_TIMEOUT_MS = 20_000;

export async function request(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  // Streaming/agent calls pass their own signal; everything else gets a timeout so the UI can't spin forever.
  const timeout = init.signal ? null : new AbortController();
  const timer = timeout ? setTimeout(() => timeout.abort(), DEFAULT_TIMEOUT_MS) : null;
  try {
    res = await fetchImpl(url, timeout ? { ...init, signal: timeout.signal } : init);
  } catch (e) {
    if (timeout?.signal.aborted) throw new ProviderError('The request timed out. Check your connection and try again.', 0, 'network_error');
    if ((e as Error).name === 'AbortError') throw e;
    throw new ProviderError('Network unavailable', 0, 'network_error');
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ProviderError(errorMessage(text, res.status), res.status, classify(res.status, text));
  }
  return res;
}

export async function requestJson<T>(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<T> {
  const res = await request(fetchImpl, url, init);
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

/** Downloads a body, refusing (without buffering) anything larger than `maxBytes`. */
export async function requestBytes(fetchImpl: FetchLike, url: string, init: RequestInit, maxBytes: number): Promise<Uint8Array> {
  const res = await request(fetchImpl, url, init);
  const tooLarge = () =>
    new ProviderError(
      `The sandbox returned more than ${Math.round(maxBytes / 1024 / 1024)} MB. Ask the agent for a smaller change.`,
      413,
      'bad_request',
    );
  const declared = Number(res.headers.get('content-length') ?? 'NaN');
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) throw tooLarge();
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

export function streamBody(res: Response): ReadableStream<Uint8Array> {
  if (!res.body) throw new ProviderError('Streaming is not supported by this fetch implementation', 0, 'server');
  return res.body;
}

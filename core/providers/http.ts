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

export async function request(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetchImpl(url, init);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ProviderError('Network unavailable', 0, 'network_error');
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

export async function requestBytes(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<Uint8Array> {
  const res = await request(fetchImpl, url, init);
  return new Uint8Array(await res.arrayBuffer());
}

export function streamBody(res: Response): ReadableStream<Uint8Array> {
  if (!res.body) throw new ProviderError('Streaming is not supported by this fetch implementation', 0, 'server');
  return res.body;
}

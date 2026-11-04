import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2.80.0';
import { checkOrigin } from './cors.ts';

export { allowedOrigins, checkOrigin, type OriginCheck, safeEqual } from './cors.ts';

/**
 * Shared helpers for HALCYX Edge Functions. Functions never log request bodies or tokens,
 * and responses carry no-store cache headers.
 *
 * CORS fails closed: a browser request is answered only when its Origin is listed in
 * ALLOWED_ORIGIN (comma-separated). Native apps send no Origin header and are unaffected.
 */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing function secret ${name}`);
  return v;
}

/** Client acting as the calling user (RLS applies). */
export function userClient(req: Request): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
}

export function adminClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
}

export async function requireUser(req: Request): Promise<User> {
  const { data, error } = await userClient(req).auth.getUser();
  if (error || !data.user) throw new HttpError(401, 'unauthorized');
  return data.user;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Reads a JSON body without buffering more than `maxBytes` (Content-Length checked first). */
export async function readJson<T>(req: Request, maxBytes = 8_192): Promise<T> {
  const declared = Number(req.headers.get('content-length') ?? 'NaN');
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(413, 'payload_too_large');
  if (!req.body) throw new HttpError(400, 'invalid_json');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new HttpError(413, 'payload_too_large');
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(buf)) as T;
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

/** Fixed-window rate limit backed by Postgres. Throws 429 when exceeded. */
export async function rateLimit(key: string, max: number, windowSeconds: number): Promise<void> {
  const { data, error } = await adminClient().rpc('hit_rate_limit', { p_key: key, p_max: max, p_window_seconds: windowSeconds });
  if (error) throw new HttpError(503, 'rate_limit_unavailable');
  if (data !== true) throw new HttpError(429, 'rate_limited');
}

/** Metadata-only audit record: who called which function and the outcome. Never blocks the response. */
export async function audit(fn: string, userId: string | null, status: number): Promise<void> {
  await adminClient()
    .from('function_audit')
    .insert({ fn, user_id: userId, status })
    .then(
      () => undefined,
      () => undefined,
    );
}

export type Context = { userId: string | null };

/**
 * Wraps a handler with origin checks, method checks, error mapping and auditing (no body logging).
 * `fn` names the function in the audit log; set `auditCalls` for credential-handling functions.
 */
export function serve(fn: string, handler: (req: Request, ctx: Context) => Promise<Response>, opts: { auditCalls?: boolean } = {}): void {
  Deno.serve(async (req) => {
    const cors = checkOrigin(req.headers.get('origin'));
    const finish = (res: Response) => {
      for (const [k, v] of Object.entries(cors.headers)) res.headers.set(k, v);
      return res;
    };
    if (!cors.ok) return finish(json({ error: 'origin_not_allowed' }, 403));
    if (req.method === 'OPTIONS') return finish(new Response(null, { status: 204 }));
    if (req.method !== 'POST') return finish(json({ error: 'method_not_allowed' }, 405));

    const ctx: Context = { userId: null };
    let res: Response;
    try {
      res = await handler(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) res = json({ error: e.message }, e.status);
      else {
        console.error('function_error', fn, (e as Error).name);
        res = json({ error: 'internal_error' }, 500);
      }
    }
    if (opts.auditCalls) await audit(fn, ctx.userId, res.status);
    return finish(res);
  });
}

import { createClient, type SupabaseClient, type User } from 'jsr:@supabase/supabase-js@2';

/**
 * Shared helpers for HALCYX Edge Functions. Functions never log request bodies or tokens,
 * and responses carry no-store cache headers.
 */
export const corsHeaders = {
  'access-control-allow-origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export function preflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  return null;
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

export async function readJson<T>(req: Request, maxBytes = 8_192): Promise<T> {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'payload_too_large');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

/** Wraps a handler with CORS, method checks and error mapping (no body logging). */
export function serve(handler: (req: Request) => Promise<Response>): void {
  Deno.serve(async (req) => {
    const early = preflight(req);
    if (early) return early;
    try {
      return await handler(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error('function_error', (e as Error).name);
      return json({ error: 'internal_error' }, 500);
    }
  });
}

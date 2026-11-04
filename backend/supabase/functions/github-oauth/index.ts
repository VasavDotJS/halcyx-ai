import { env, HttpError, json, rateLimit, readJson, requireUser, serve } from '../_shared/http.ts';

/**
 * GitHub App user-token exchange (authorization_code + PKCE, and refresh_token).
 * The client secret lives only here. Tokens pass through in memory and are returned to the
 * device; nothing is stored or logged.
 */
type Body =
  | { grant_type: 'authorization_code'; code: string; code_verifier: string; redirect_uri: string }
  | { grant_type: 'refresh_token'; refresh_token: string };

const allowedRedirects = () =>
  (Deno.env.get('GITHUB_REDIRECT_URIS') ?? 'halcyx://github-callback')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

serve(
  'github-oauth',
  async (req, ctx) => {
    const user = await requireUser(req);
    ctx.userId = user.id;
    await rateLimit(`github-oauth:${user.id}`, 30, 3600);
    const body = await readJson<Body>(req);
    const params = new URLSearchParams({ client_id: env('GITHUB_APP_CLIENT_ID'), client_secret: env('GITHUB_APP_CLIENT_SECRET') });

    if (body.grant_type === 'authorization_code') {
      if (!body.code || !/^[A-Za-z0-9_-]{43,128}$/.test(body.code_verifier ?? '')) throw new HttpError(400, 'invalid_request');
      if (!allowedRedirects().includes(body.redirect_uri)) throw new HttpError(400, 'redirect_uri_not_allowed');
      params.set('code', body.code);
      params.set('code_verifier', body.code_verifier);
      params.set('redirect_uri', body.redirect_uri);
    } else if (body.grant_type === 'refresh_token') {
      if (!body.refresh_token) throw new HttpError(400, 'invalid_request');
      params.set('grant_type', 'refresh_token');
      params.set('refresh_token', body.refresh_token);
    } else {
      throw new HttpError(400, 'unsupported_grant_type');
    }

    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok || typeof data.access_token !== 'string') {
      throw new HttpError(400, typeof data.error === 'string' ? data.error : 'exchange_failed');
    }
    return json({
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? null,
      expires_in: data.expires_in ?? null,
      refresh_token_expires_in: data.refresh_token_expires_in ?? null,
    });
  },
  { auditCalls: true },
);

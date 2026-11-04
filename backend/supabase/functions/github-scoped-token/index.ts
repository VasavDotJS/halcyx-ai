import { env, HttpError, json, rateLimit, readJson, requireUser, serve } from '../_shared/http.ts';

/**
 * Mints a repository-scoped, read-only user token for the agent sandbox via GitHub's
 * "Create a scoped access token" endpoint. The sandbox can clone but never push — which also
 * makes force-pushes impossible from the agent side.
 */
type Body = { access_token: string; repository_id: number };

serve(
  'github-scoped-token',
  async (req, ctx) => {
    const user = await requireUser(req);
    ctx.userId = user.id;
    await rateLimit(`github-scoped-token:${user.id}`, 60, 3600);
    const body = await readJson<Body>(req);
    if (typeof body.access_token !== 'string' || !Number.isInteger(body.repository_id)) throw new HttpError(400, 'invalid_request');

    const clientId = env('GITHUB_APP_CLIENT_ID');
    const basic = btoa(`${clientId}:${env('GITHUB_APP_CLIENT_SECRET')}`);
    const res = await fetch(`https://api.github.com/applications/${clientId}/token/scoped`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        access_token: body.access_token,
        repository_ids: [body.repository_id],
        permissions: { contents: 'read', metadata: 'read' },
      }),
    });
    const data = (await res.json()) as { token?: string; message?: string };
    if (!res.ok || !data.token) throw new HttpError(res.status === 404 ? 404 : 400, 'scope_failed');
    return json({ token: data.token });
  },
  { auditCalls: true },
);

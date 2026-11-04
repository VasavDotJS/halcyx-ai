import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

function headerCsp(): { sw: string; vercel: string; netlify: string; meta: string } {
  const sw = /const CSP =\s*"([^"]+)"/.exec(read('public/sw.js'))![1]!;
  const vercelJson = JSON.parse(read('vercel.json')) as { headers: { headers: { key: string; value: string }[] }[] };
  const vercel = vercelJson.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy')!.value;
  const netlify = /Content-Security-Policy = "([^"]+)"/.exec(read('netlify.toml'))![1]!;
  const meta = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(read('public/index.html'))![1]!;
  return { sw, vercel, netlify, meta };
}

describe('PWA hardening', () => {
  it('serves one CSP everywhere, as a header with frame-ancestors and form-action', () => {
    const { sw, vercel, netlify, meta } = headerCsp();
    expect(vercel).toBe(sw);
    expect(netlify).toBe(sw);
    expect(sw).toContain("frame-ancestors 'none'");
    expect(sw).toContain("form-action 'self'");
    expect(sw.startsWith(meta)).toBe(true);
    expect(sw).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  it('runs previews without same-origin access', () => {
    const src = read('ui/PreviewFrame.web.tsx');
    const sandbox = /sandbox: '([^']+)'/.exec(src)![1]!;
    expect(sandbox.split(' ').sort()).toEqual(['allow-forms', 'allow-scripts']);
  });

  it('never rewrites missing build assets to the app shell on Netlify', () => {
    const toml = read('netlify.toml');
    expect(toml.indexOf('from = "/_expo/*"')).toBeLessThan(toml.indexOf('from = "/*"'));
    expect(toml).toMatch(/from = "\/_expo\/\*"\s+to = "\/404.html"\s+status = 404/);
  });
});

type FetchEvent = { request: { url: string; method: string; mode: string }; respondWith: (p: Promise<Response>) => void };

function loadServiceWorker(userAgent: string, upstream: (url: string) => Response) {
  const listeners: Record<string, (e: unknown) => void> = {};
  const self = {
    registration: { scope: 'https://vasavdotjs.github.io/halcyx-ai/' },
    navigator: { userAgent },
    location: { origin: 'https://vasavdotjs.github.io' },
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn),
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
  };
  const caches = {
    match: async () => undefined,
    open: async () => ({ put: async () => undefined, addAll: async () => undefined }),
    keys: async () => [],
  };
  const context = vm.createContext({ self, caches, fetch: async (r: { url: string }) => upstream(r.url), Headers, Response, URL });
  vm.runInContext(read('public/sw.js'), context);
  return async (url: string, mode = 'navigate'): Promise<Response | null> => {
    let responded: Promise<Response> | null = null;
    const ev: FetchEvent = { request: { url, method: 'GET', mode }, respondWith: (p) => (responded = p) };
    listeners.fetch!(ev);
    return responded ? await responded : null;
  };
}

describe('service worker', () => {
  const chrome = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
  const safari =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';

  it('adds isolation and security headers to pages when the host sends none', async () => {
    const handle = loadServiceWorker(chrome, () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }));
    const res = (await handle('https://vasavdotjs.github.io/halcyx-ai/sign-in'))!;
    expect(res.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(res.headers.get('Cross-Origin-Embedder-Policy')).toBe('credentialless');
    expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await res.text()).toBe('<html></html>');
  });

  it('uses require-corp on Safari, which lacks credentialless', async () => {
    const handle = loadServiceWorker(safari, () => new Response('x'));
    expect((await handle('https://vasavdotjs.github.io/halcyx-ai/'))!.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
  });

  it('leaves headers a host already sends untouched', async () => {
    const handle = loadServiceWorker(chrome, () => new Response('x', { headers: { 'Cross-Origin-Embedder-Policy': 'require-corp' } }));
    expect((await handle('https://vasavdotjs.github.io/halcyx-ai/'))!.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
  });

  it('never intercepts API traffic to other origins', async () => {
    const handle = loadServiceWorker(chrome, () => new Response('x'));
    expect(await handle('https://api.github.com/user', 'cors')).toBeNull();
    expect(await handle('https://dwlzymxsatgcsgnokwwl.supabase.co/rest/v1/model_config', 'cors')).toBeNull();
  });
});

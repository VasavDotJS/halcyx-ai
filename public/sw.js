/*
 * App-shell service worker. Caches only same-origin static assets so history and pending
 * diffs (stored encrypted in IndexedDB) can be browsed offline. API traffic to providers,
 * GitHub and Supabase is never cached.
 *
 * It also makes the app cross-origin isolated on hosts that can't send custom headers
 * (GitHub Pages): SQLite on the web needs SharedArrayBuffer, which needs COOP + COEP.
 * Hosts that already send them (vercel.json / netlify.toml) are left untouched.
 */
const CACHE = 'halcyx-shell-v2';
const scoped = (path) => new URL(path, self.registration.scope).href;
const SHELL = ['./', 'index.html', 'manifest.json', 'favicon.png', 'pwa-192.png', 'pwa-512.png'].map(scoped);

// Safari has no COEP "credentialless"; "require-corp" still isolates same-origin content.
const ua = self.navigator.userAgent;
const COEP = /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|Firefox|FxiOS/.test(ua) ? 'require-corp' : 'credentialless';

function isolate(res) {
  if (!res || res.status === 0 || res.type === 'opaque' || res.headers.has('Cross-Origin-Embedder-Policy')) return res;
  const headers = new Headers(res.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', COEP);
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match(scoped('index.html')))
        .then(isolate),
    );
    return;
  }
  event.respondWith(
    caches
      .match(event.request)
      .then(
        (hit) =>
          hit ||
          fetch(event.request).then((res) => {
            if (res.ok && /\.(js|css|png|ttf|woff2?|wasm)$/.test(url.pathname)) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(event.request, copy));
            }
            return res;
          }),
      )
      .then(isolate),
  );
});

import { rebaseHtml } from '../scripts/rebase-html.mjs';

jest.mock('react-native', () => ({ Platform: { OS: 'web' } }));
jest.mock('expo-linking', () => ({ createURL: (p: string) => `halcyx://${p}` }));

describe('GitHub Pages base path', () => {
  const html =
    '<link rel="icon" href="/favicon.png" /><link rel="manifest" href="/manifest.json" />' +
    '<script src="/register-sw.js" defer></script><script src="/halcyx-ai/_expo/static/js/web/entry.js"></script>' +
    '<a href="//cdn.example.com/x">x</a><a href="https://example.com/">y</a>';

  it('prefixes root-absolute links once and leaves others alone', () => {
    const out = rebaseHtml(html, '/halcyx-ai');
    expect(out).toContain('href="/halcyx-ai/favicon.png"');
    expect(out).toContain('href="/halcyx-ai/manifest.json"');
    expect(out).toContain('src="/halcyx-ai/register-sw.js"');
    expect(out).toContain('src="/halcyx-ai/_expo/static/js/web/entry.js"');
    expect(out).not.toContain('/halcyx-ai/halcyx-ai/');
    expect(out).toContain('href="//cdn.example.com/x"');
    expect(out).toContain('href="https://example.com/"');
    expect(rebaseHtml(html, '')).toBe(html);
  });

  it('builds auth redirect URLs under the base path on web', () => {
    const { appUrl } = jest.requireActual<typeof import('@/core/platform/links')>('@/core/platform/links');
    const g = globalThis as { location?: { origin: string } };
    const prev = g.location;
    g.location = { origin: 'https://vasavdotjs.github.io' };
    try {
      expect(appUrl('auth-callback', '/halcyx-ai')).toBe('https://vasavdotjs.github.io/halcyx-ai/auth-callback');
      expect(appUrl('auth-callback?type=recovery', '/halcyx-ai/')).toBe(
        'https://vasavdotjs.github.io/halcyx-ai/auth-callback?type=recovery',
      );
      expect(appUrl('github-callback', '')).toBe('https://vasavdotjs.github.io/github-callback');
    } finally {
      g.location = prev;
    }
  });
});

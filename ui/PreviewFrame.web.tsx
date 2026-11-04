import { createElement } from 'react';

/**
 * Web/PWA preview in a sandboxed iframe. Agent-controlled content gets scripts and forms but
 * no `allow-same-origin`, so it runs in an opaque origin with no storage or cookies. Apps that
 * need storage can be opened in the browser instead. Remount (key) to reload.
 */
export function PreviewFrame({ url }: { url: string }) {
  return createElement('iframe', {
    title: 'Live preview',
    src: url,
    sandbox: 'allow-scripts allow-forms',
    referrerPolicy: 'no-referrer',
    style: { flex: 1, border: 0, width: '100%', height: '100%' },
  });
}

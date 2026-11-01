import { createElement } from 'react';

/** Web/PWA preview in a sandboxed iframe. Remount (key) to reload. */
export function PreviewFrame({ url }: { url: string }) {
  return createElement('iframe', {
    title: 'Live preview',
    src: url,
    sandbox: 'allow-scripts allow-forms allow-same-origin',
    referrerPolicy: 'no-referrer',
    style: { flex: 1, border: 0, width: '100%', height: '100%' },
  });
}

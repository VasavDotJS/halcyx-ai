/** Prefixes root-absolute href/src attributes with a deploy base path, skipping ones that already have it. */
export function rebaseHtml(html, base) {
  const prefix = base.replace(/\/+$/, '');
  if (!prefix) return html;
  return html.replace(/\b(href|src)="\/(?!\/)([^"]*)"/g, (match, attr, rest) =>
    `/${rest}`.startsWith(`${prefix}/`) ? match : `${attr}="${prefix}/${rest}"`,
  );
}

// Post-processes `expo export --platform web` output for static hosts that serve the app from
// a sub-path and can't rewrite routes (GitHub Pages):
//   node scripts/prepare-pages.mjs <dist> <base>      e.g.  node scripts/prepare-pages.mjs dist /halcyx-ai
// - prefixes root-absolute href/src in index.html with the base (Expo already does this for its bundles)
// - copies index.html to 404.html so deep links like /halcyx-ai/chat/abc load the app
// - adds .nojekyll so folders starting with "_" (Expo's /_expo) are published
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rebaseHtml } from './rebase-html.mjs';

const [, , dist, base = ''] = process.argv;
if (!dist) {
  console.error('usage: node scripts/prepare-pages.mjs <dist> <base>');
  process.exit(1);
} else {
  const file = join(dist, 'index.html');
  const html = rebaseHtml(readFileSync(file, 'utf8'), base);
  writeFileSync(file, html);
  writeFileSync(join(dist, '404.html'), html);
  writeFileSync(join(dist, '.nojekyll'), '');
  console.warn(`Prepared ${dist} for base "${base || '/'}"`);
}

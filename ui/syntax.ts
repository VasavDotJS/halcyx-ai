import type { Theme } from './themes';

/** Maps file extensions to Prism grammar names. */
export function languageFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    mjs: 'javascript',
    cjs: 'javascript',
    json: 'json',
    md: 'markdown',
    py: 'python',
    go: 'go',
    rs: 'rust',
    rb: 'ruby',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    css: 'css',
    scss: 'css',
    html: 'markup',
    xml: 'markup',
    svg: 'markup',
    yml: 'yaml',
    yaml: 'yaml',
    sh: 'bash',
    bash: 'bash',
    sql: 'sql',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    graphql: 'graphql',
  };
  return map[ext] ?? 'plain';
}

/** Token colors derived from theme tokens so highlighting follows every theme. */
export function syntaxColors(t: Theme): Record<string, string> {
  const c = t.colors;
  return {
    comment: c.muted,
    prolog: c.muted,
    keyword: c.accent,
    builtin: c.accent,
    string: c.success,
    char: c.success,
    number: c.warning,
    boolean: c.warning,
    constant: c.warning,
    function: c.fg,
    'class-name': c.warning,
    operator: c.muted,
    punctuation: c.muted,
    tag: c.accent,
    'attr-name': c.warning,
    'attr-value': c.success,
    property: c.fg,
    deleted: c.danger,
    inserted: c.success,
  };
}

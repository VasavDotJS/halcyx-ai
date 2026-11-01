import { SECRET_RULES, SENSITIVE_PATHS } from './secretRules';

export type SecretFinding = {
  path: string;
  line: number;
  ruleId: string;
  description: string;
  /** Redacted preview, never the full secret. */
  preview: string;
};

export function shannonEntropy(s: string): number {
  if (!s) return 0;
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

export function redact(secret: string): string {
  if (secret.length <= 8) return '••••';
  return `${secret.slice(0, 4)}••••${secret.slice(-3)}`;
}

const PLACEHOLDER = /(x{6,}|your[_-]?|example|placeholder|changeme|dummy|<[^>]+>|\$\{)/i;

export function scanPath(path: string): SecretFinding | null {
  for (const p of SENSITIVE_PATHS) {
    if (p.pattern.test(path)) {
      if (p.description === 'allow') return null;
      return { path, line: 0, ruleId: 'sensitive-file', description: p.description, preview: path };
    }
  }
  return null;
}

export function scanText(path: string, text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lineStarts = [0];
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);
  const lineOf = (index: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  for (const rule of SECRET_RULES) {
    rule.regex.lastIndex = 0;
    for (const m of text.matchAll(rule.regex)) {
      const secret = m[rule.group ?? 0] ?? m[0];
      if (rule.minEntropy !== undefined && shannonEntropy(secret) < rule.minEntropy) continue;
      if (rule.id === 'generic-assignment' && PLACEHOLDER.test(secret)) continue;
      findings.push({
        path,
        line: lineOf(m.index ?? 0),
        ruleId: rule.id,
        description: rule.description,
        preview: redact(secret),
      });
    }
  }
  return findings;
}

/** Scans every file that is about to be pushed. Binary files are only checked by path. */
export function scanChanges(files: { path: string; text: string | null }[]): SecretFinding[] {
  const out: SecretFinding[] = [];
  for (const f of files) {
    const byPath = scanPath(f.path);
    if (byPath) out.push(byPath);
    if (f.text !== null) out.push(...scanText(f.path, f.text));
  }
  return out;
}

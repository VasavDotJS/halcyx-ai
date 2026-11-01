import { SECRET_RULES } from './secretRules';

/**
 * Scrubbing for anything that leaves the device toward HALCYX infrastructure (Sentry,
 * backend metadata). Removes provider keys/tokens and anything that looks like source code.
 */

const CODE_HINT = /(\n.*){3,}|[{};]\s*\n|=>|function\s*\(|import\s+[\w{*]|class\s+\w+|def\s+\w+\(|<\/?\w+[\s>]/;

export function scrubString(input: string): string {
  let out = input;
  for (const rule of SECRET_RULES) {
    rule.regex.lastIndex = 0;
    out = out.replace(rule.regex, `[redacted:${rule.id}]`);
  }
  out = out.replace(/(authorization|x-api-key|x-goog-api-key)\s*[:=]\s*\S+/gi, '$1: [redacted]');
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, 'Bearer [redacted]');
  if (out.length > 300 && CODE_HINT.test(out)) return '[redacted:possible-source]';
  return out;
}

const DROP_KEYS = /^(content|code|diff|patch|source|text|body|data|prompt|key|apiKey|token|secret|password|headers|cookies)$/i;

/** Deep-scrubs an arbitrary value: drops sensitive keys entirely and redacts strings. */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrubValue(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = DROP_KEYS.test(k) ? '[dropped]' : scrubValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

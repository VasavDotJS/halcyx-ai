import type { ProviderId } from '@/core/types';

/** Recognisable key shapes per provider, used for clipboard auto-detect and input validation. */
const FORMATS: Record<ProviderId, RegExp> = {
  gemini: /^AIza[0-9A-Za-z_-]{35}$/,
  anthropic: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
  openai: /^sk-[A-Za-z0-9_-]{20,}$/,
};

export function looksLikeKey(provider: ProviderId, value: string): boolean {
  return FORMATS[provider].test(value.trim());
}

/** Finds a provider key inside arbitrary clipboard text (users often copy surrounding whitespace). */
export function extractKey(provider: ProviderId, text: string): string | null {
  for (const token of text.split(/\s+/)) {
    const t = token.replace(/^["'`]+|["'`,;]+$/g, '');
    if (looksLikeKey(provider, t)) return t;
  }
  return null;
}

/** `AIzaSyD…9xQ` → `AIza••••9xQ` — matches the masking in the spec. */
export function maskKey(key: string): string {
  const k = key.trim();
  if (k.length < 10) return '••••';
  const head = k.startsWith('sk-ant-') ? 'sk-ant-' : k.startsWith('sk-') ? 'sk-' : k.slice(0, 4);
  return `${head}••••${k.slice(-3)}`;
}

import { PROVIDER_IDS, type ProviderId } from '@/core/types';
import { anthropicAdapter } from './anthropic';
import { geminiAdapter } from './gemini';
import { openaiAdapter } from './openai';
import type { ProviderAdapter } from './types';

/** Add a provider by implementing ProviderAdapter and registering it here — no UI changes. */
export const PROVIDERS: Record<ProviderId, ProviderAdapter> = {
  gemini: geminiAdapter,
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
};

export const PROVIDER_ORDER: readonly ProviderId[] = PROVIDER_IDS;

export function adapterFor(id: ProviderId): ProviderAdapter {
  return PROVIDERS[id];
}

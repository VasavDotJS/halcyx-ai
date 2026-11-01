import type { Effort, ModelInfo, ProviderId } from '@/core/types';

/**
 * Effort → provider-native parameters (verified against provider docs, Nov 2026):
 * - Gemini Antigravity agent: `agent_config` exposes `model` and `max_total_tokens` but no
 *   thinking level, so effort maps to the token budget. Plain Gemini chat uses
 *   `generation_config.thinking_level` (low | medium | high).
 * - Anthropic Managed Agents: `model: { id, effort }` (low | medium | high | xhigh | max).
 * - OpenAI Responses: `reasoning.effort` (low | medium | high | xhigh | max).
 */
export const GEMINI_AGENT_BUDGET: Record<Exclude<Effort, 'max'>, number> = {
  low: 400_000,
  medium: 1_500_000,
  high: 4_000_000,
};

export function mapEffort(provider: ProviderId, model: string, effort: Effort, mode: 'agent' | 'chat' = 'agent') {
  switch (provider) {
    case 'gemini': {
      const level = effort === 'max' ? 'high' : effort;
      return mode === 'agent'
        ? { agent_config: { type: 'antigravity', model, max_total_tokens: GEMINI_AGENT_BUDGET[level] } }
        : { generation_config: { thinking_level: level } };
    }
    case 'anthropic':
      return { model: { id: model, effort } };
    case 'openai':
      return { reasoning: { effort, summary: 'auto' } };
  }
}

const TOKEN_MULTIPLIER: Record<Effort, number> = { low: 0.45, medium: 1, high: 2.2, max: 4 };
/** Typical agent task footprint at medium effort, from provider cost guidance. */
const TYPICAL = { input: 300_000, output: 30_000, cachedShare: 0.6 };

export type EffortEstimate = {
  /** Estimated USD for a typical task. */
  usd: number;
  /** Cost relative to this model at medium effort. */
  relativeCost: number;
  speed: 'Fastest' | 'Fast' | 'Moderate' | 'Slow' | 'Slowest';
  approximate: boolean;
};

export function estimate(model: ModelInfo, effort: Effort): EffortEstimate {
  const m = TOKEN_MULTIPLIER[effort];
  const freshInput = TYPICAL.input * (1 - TYPICAL.cachedShare) + TYPICAL.input * TYPICAL.cachedShare * 0.1;
  const usd = ((freshInput * m) / 1e6) * model.pricing.inputPerM + ((TYPICAL.output * m) / 1e6) * model.pricing.outputPerM;
  const score = model.speed / Math.sqrt(m);
  const speed = score >= 5 ? 'Fastest' : score >= 3.5 ? 'Fast' : score >= 2.2 ? 'Moderate' : score >= 1.3 ? 'Slow' : 'Slowest';
  return { usd: Math.round(usd * 100) / 100, relativeCost: m, speed, approximate: !model.pricing.verified };
}

export function costOf(model: ModelInfo, inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1e6) * model.pricing.inputPerM + (outputTokens / 1e6) * model.pricing.outputPerM;
}

/** Converts a remaining USD budget into a token ceiling for the agent (conservative: output price). */
export function budgetToTokens(model: ModelInfo, remainingUsd: number): number {
  const blended = model.pricing.inputPerM * 0.85 + model.pricing.outputPerM * 0.15;
  return Math.max(0, Math.floor((remainingUsd / blended) * 1e6));
}

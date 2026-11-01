import bundled from '@/config/models.json';
import { EFFORT_ORDER, type Effort, type ModelInfo, type ProviderId } from '@/core/types';

export type ModelConfig = {
  version: string;
  agents: { gemini: string };
  providers: Record<ProviderId, ModelInfo[]>;
};

const PROVIDERS: ProviderId[] = ['gemini', 'anthropic', 'openai'];

function isEffort(v: unknown): v is Effort {
  return typeof v === 'string' && (EFFORT_ORDER as string[]).includes(v);
}

function validModel(m: unknown): m is ModelInfo {
  if (!m || typeof m !== 'object') return false;
  const x = m as Record<string, unknown>;
  const pricing = x.pricing as Record<string, unknown> | undefined;
  return (
    typeof x.id === 'string' &&
    /^[a-z0-9][a-z0-9.\-_]{1,80}$/.test(x.id) &&
    typeof x.label === 'string' &&
    typeof x.tagline === 'string' &&
    Array.isArray(x.efforts) &&
    x.efforts.length > 0 &&
    x.efforts.every(isEffort) &&
    isEffort(x.defaultEffort) &&
    (x.efforts as string[]).includes(x.defaultEffort as string) &&
    !!pricing &&
    typeof pricing.inputPerM === 'number' &&
    typeof pricing.outputPerM === 'number' &&
    typeof x.speed === 'number'
  );
}

/**
 * Validates remote config (Supabase `model_config`) and falls back per provider to the
 * bundled list, so a malformed remote file can never brick the model picker.
 */
export function parseModelConfig(remote: unknown): ModelConfig {
  const base = bundled as ModelConfig;
  if (!remote || typeof remote !== 'object') return base;
  const r = remote as Partial<ModelConfig>;
  const providers = { ...base.providers };
  for (const p of PROVIDERS) {
    const list = r.providers?.[p];
    if (Array.isArray(list) && list.length && list.every(validModel)) providers[p] = list;
  }
  const agent = r.agents?.gemini;
  return {
    version: typeof r.version === 'string' ? r.version : base.version,
    agents: { gemini: typeof agent === 'string' && /^[a-z0-9-]+$/.test(agent) ? agent : base.agents.gemini },
    providers,
  };
}

export const BUNDLED_MODEL_CONFIG = bundled as ModelConfig;

export function defaultModel(cfg: ModelConfig, provider: ProviderId): ModelInfo {
  const list = cfg.providers[provider];
  return list.find((m) => m.default) ?? list[0]!;
}

export function findModel(cfg: ModelConfig, provider: ProviderId, id: string): ModelInfo | null {
  return cfg.providers[provider].find((m) => m.id === id) ?? null;
}

/** Nearest supported effort (e.g. "max" on a Gemini model becomes "high"). */
export function clampEffort(model: ModelInfo, effort: Effort): Effort {
  if (model.efforts.includes(effort)) return effort;
  const want = EFFORT_ORDER.indexOf(effort);
  const supported = [...model.efforts].sort((a, b) => EFFORT_ORDER.indexOf(a) - EFFORT_ORDER.indexOf(b));
  return supported.filter((e) => EFFORT_ORDER.indexOf(e) <= want).pop() ?? supported[0]!;
}

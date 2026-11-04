import { SECRET_RULES } from '@/core/security/secretRules';
import { SYNCED_FIELDS } from '@/core/settings/types';
import { PROVIDER_IDS, THEME_NAMES } from '@/core/types';

/**
 * Hard rule: the HALCYX backend never receives provider API keys or source code.
 * Every write to Supabase goes through `assertMetadataOnly`, an allow-list per table with
 * strict per-field validators. Unknown fields, long free text and anything matching a
 * secret pattern are rejected before the request is made.
 */
export class MetadataViolation extends Error {}

type Validator = (v: unknown) => boolean;

const str =
  (max: number, re?: RegExp): Validator =>
  (v) =>
    typeof v === 'string' && v.length <= max && (!re || re.test(v));
const nullable =
  (f: Validator): Validator =>
  (v) =>
    v === null || f(v);
const int: Validator = (v) => Number.isInteger(v) && (v as number) >= 0;
const num: Validator = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const bool: Validator = (v) => typeof v === 'boolean';
const oneOf =
  (...xs: string[]): Validator =>
  (v) =>
    typeof v === 'string' && xs.includes(v);
const iso = str(40, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);

const ID = str(64, /^[A-Za-z0-9_-]+$/);
const REPO = str(140, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
const BRANCH = str(255, /^[A-Za-z0-9._/-]+$/);
const SHA = nullable(str(40, /^[0-9a-f]{40}$/));
const PROVIDER = oneOf(...PROVIDER_IDS);
const MODEL = str(80, /^[a-z0-9][a-z0-9.\-_]*$/);

const SETTINGS_VALIDATORS: Record<(typeof SYNCED_FIELDS)[number], Validator> = {
  theme: oneOf('system', ...THEME_NAMES),
  accent: nullable(str(7, /^#[0-9A-Fa-f]{6}$/)),
  retentionHours: (v) => int(v) && (v as number) >= 1 && (v as number) <= 168,
  approvalMode: bool,
  askBeforeCommands: bool,
  agentNetwork: oneOf('registries', 'open'),
  defaultProvider: PROVIDER,
  defaultModel: (v) => !!v && typeof v === 'object' && Object.entries(v as object).every(([k, m]) => PROVIDER(k) && MODEL(m)),
  defaultEffort: oneOf('low', 'medium', 'high', 'max'),
  monthlyBudgetUsd: nullable(num),
  budgetAlertPct: (v) => int(v) && (v as number) <= 100,
  hardCap: bool,
  autoClean: bool,
  autoCleanDays: (v) => int(v) && (v as number) <= 365,
  keepSandboxAfterPush: bool,
  notifyOnFinish: bool,
  emailDigest: oneOf('off', 'daily', 'weekly'),
};

const SCHEMAS: Record<string, Record<string, Validator>> = {
  task_log: {
    task_id: ID,
    repo: REPO,
    branch: nullable(BRANCH),
    commit_sha: SHA,
    provider: PROVIDER,
    model: MODEL,
    input_tokens: int,
    output_tokens: int,
    cost_usd: num,
    files_count: int,
    status: oneOf('running', 'completed', 'failed', 'cancelled', 'incomplete', 'pushed', 'expired', 'discarded'),
    started_at: iso,
    finished_at: nullable(iso),
  },
  devices: {
    device_id: ID,
    name: str(80, /^[^\n\r]*$/),
    platform: oneOf('ios', 'android', 'web'),
    push_token: nullable(str(200, /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/)),
    app_version: str(32, /^[0-9A-Za-z.+-]+$/),
    session_id: nullable(str(64, /^[0-9a-f-]+$/)),
    last_seen_at: iso,
  },
  user_settings: { ...SETTINGS_VALIDATORS, updated_at: iso },
  notify: {
    kind: oneOf('task_finished', 'task_failed', 'needs_approval', 'workspace_expiring'),
    task_id: ID,
    repo: REPO,
  },
};

export function containsSecret(v: unknown): boolean {
  const text = JSON.stringify(v);
  return SECRET_RULES.some((r) => {
    r.regex.lastIndex = 0;
    return r.regex.test(text);
  });
}

export function assertMetadataOnly(table: keyof typeof SCHEMAS | string, row: Record<string, unknown>): void {
  const schema = SCHEMAS[table];
  if (!schema) throw new MetadataViolation(`No metadata schema for "${table}"`);
  for (const [k, v] of Object.entries(row)) {
    const validate = schema[k];
    if (!validate) throw new MetadataViolation(`Field "${table}.${k}" is not allowed`);
    if (!validate(v)) throw new MetadataViolation(`Field "${table}.${k}" failed validation`);
  }
  if (containsSecret(row)) throw new MetadataViolation(`Payload for "${table}" looks like it contains a secret`);
}

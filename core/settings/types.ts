import type { AgentNetwork, Effort, ProviderId, RepoRef, ThemePreference } from '@/core/types';

export type Settings = {
  theme: ThemePreference;
  accent: string | null;
  retentionHours: number;
  appLock: boolean;
  autoLockMinutes: number;
  approvalMode: boolean;
  askBeforeCommands: boolean;
  /** Sandbox internet access; "registries" blocks sending code to arbitrary hosts. */
  agentNetwork: AgentNetwork;
  defaultProvider: ProviderId;
  defaultModel: Partial<Record<ProviderId, string>>;
  defaultEffort: Effort;
  monthlyBudgetUsd: number | null;
  budgetAlertPct: number;
  hardCap: boolean;
  autoClean: boolean;
  autoCleanDays: number;
  keepSandboxAfterPush: boolean;
  notifyOnFinish: boolean;
  emailDigest: 'off' | 'daily' | 'weekly';
  sendWithReturn: boolean;
  haptics: boolean;
  billingReminder: boolean;
  onboarded: boolean;
  /** Local only (not synced): last repository used in the composer. */
  lastRepo: RepoRef | null;
  lastBranch: string | null;
};

/** Secure, simple defaults (see DECISIONS.md). */
export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  accent: null,
  retentionHours: 72,
  appLock: false,
  autoLockMinutes: 5,
  approvalMode: true,
  askBeforeCommands: false,
  agentNetwork: 'registries',
  defaultProvider: 'gemini',
  defaultModel: {},
  defaultEffort: 'medium',
  monthlyBudgetUsd: null,
  budgetAlertPct: 80,
  hardCap: true,
  autoClean: true,
  autoCleanDays: 14,
  keepSandboxAfterPush: false,
  notifyOnFinish: true,
  emailDigest: 'off',
  sendWithReturn: false,
  haptics: true,
  billingReminder: false,
  onboarded: false,
  lastRepo: null,
  lastBranch: null,
};

/** Fields mirrored to Supabase `user_settings` (preferences only; never keys or code). */
export const SYNCED_FIELDS = [
  'theme',
  'accent',
  'retentionHours',
  'approvalMode',
  'askBeforeCommands',
  'agentNetwork',
  'defaultProvider',
  'defaultModel',
  'defaultEffort',
  'monthlyBudgetUsd',
  'budgetAlertPct',
  'hardCap',
  'autoClean',
  'autoCleanDays',
  'keepSandboxAfterPush',
  'notifyOnFinish',
  'emailDigest',
] as const satisfies readonly (keyof Settings)[];

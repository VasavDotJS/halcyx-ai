/** Shared domain types. Everything here is plain data so it can cross module boundaries safely. */

export type ProviderId = 'gemini' | 'anthropic' | 'openai';
export type Effort = 'low' | 'medium' | 'high' | 'max';
export const EFFORT_ORDER: Effort[] = ['low', 'medium', 'high', 'max'];

export type ModelInfo = {
  id: string;
  label: string;
  tagline: string;
  efforts: Effort[];
  defaultEffort: Effort;
  /** USD per 1M tokens. `verified=false` means the price is an estimate shown with "≈". */
  pricing: { inputPerM: number; outputPerM: number; verified: boolean };
  /** 1 (slowest) .. 5 (fastest), used for the live speed estimate next to the effort slider. */
  speed: number;
  default?: boolean;
};

export type KeyStatus = 'valid' | 'invalid' | 'quota_exceeded' | 'network_error' | 'unknown';
export type KeyValidation = { status: KeyStatus; checkedAt: number; message?: string };

export type RepoRef = {
  owner: string;
  name: string;
  id: number;
  defaultBranch: string;
  private: boolean;
};

export type ImageInput = { mimeType: string; base64: string };

export type AgentTaskRequest = {
  taskId: string;
  provider: ProviderId;
  prompt: string;
  images: ImageInput[];
  model: string;
  effort: Effort;
  repo: RepoRef;
  baseBranch: string;
  baseSha: string;
  /** Read-only, repo-scoped GitHub token used by the sandbox to clone. Never write-capable. */
  readToken: string | null;
  /** Extra per-repo instructions (AGENTS.md style) set by the user. */
  instructions: string;
  approvalMode: boolean;
  askBeforeCommands: boolean;
  /** Hard token budget derived from the user's cost cap, if any. */
  tokenBudget: number | null;
  /** Continue in an existing sandbox (follow-ups, rebases). */
  resume: { remoteId: string; environmentId: string | null } | null;
  /** Multi-agent runs push to halcyx/<slug>-a, -b, -c. */
  branchSuffix: string | null;
};

export type AgentTaskHandle = {
  provider: ProviderId;
  taskId: string;
  remoteId: string;
  environmentId: string | null;
  model: string;
  /** Provider-specific opaque state persisted with the task for crash-safe resume. */
  state: Record<string, unknown>;
};

export type TaskStatus = 'queued' | 'running' | 'paused' | 'awaiting_approval' | 'completed' | 'incomplete' | 'failed' | 'cancelled';

export type StepKind = 'plan' | 'command' | 'file' | 'search' | 'tool' | 'test';

export type AgentEvent =
  | { type: 'meta'; remoteId?: string; environmentId?: string }
  | { type: 'status'; status: TaskStatus; detail?: string }
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'step'; id: string; kind: StepKind; title: string; state: 'started' | 'done' | 'error'; detail?: string }
  | { type: 'terminal'; stepId: string; chunk: string }
  | { type: 'file_change'; path: string; change: FileChangeKind }
  | { type: 'approval'; approvalId: string; title: string; detail: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'preview_url'; url: string }
  | { type: 'error'; message: string };

export type FileChangeKind = 'added' | 'modified' | 'deleted';

export type SandboxChecks = {
  lint: { status: 'passed' | 'failed' | 'not_run'; summary: string };
  tests: { status: 'passed' | 'failed' | 'not_run'; summary: string };
};

/** Files pulled back from the sandbox after a run. `files` hold full new contents. */
export type ChangeSet = {
  files: { path: string; bytes: Uint8Array }[];
  deleted: string[];
  summary: string;
  commitMessage: string;
  checks: SandboxChecks;
};

export type SandboxEntry = { path: string; bytes: number };

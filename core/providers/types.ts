import type {
  AgentEvent,
  AgentTaskHandle,
  AgentTaskRequest,
  ChangeSet,
  Effort,
  KeyValidation,
  ModelInfo,
  ProviderId,
  SandboxEntry,
} from '@/core/types';
import type { FetchLike } from './http';
import type { ModelConfig } from './modelConfig';

/** Read access to the task's base repository (used by providers without a hosted sandbox). */
export type RepoReader = {
  list(): Promise<string[]>;
  read(path: string): Promise<Uint8Array | null>;
};

export type ProviderContext = {
  apiKey: string;
  fetch: FetchLike;
  signal?: AbortSignal;
  /** Small non-secret cache (agent/environment IDs) persisted on device. */
  cache: { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void> };
  /** Encrypted per-task checkpoint for adapters that run their loop on device. */
  checkpoint: { load(): Promise<string | null>; save(json: string): Promise<void> };
  repo: RepoReader;
  isWeb: boolean;
};

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly label: string;
  /** True when code runs in the provider's isolated cloud sandbox. */
  readonly hasHostedSandbox: boolean;
  /** How strictly approval mode is enforced: by the provider runtime, or by instructions. */
  readonly approvalEnforcement: 'runtime' | 'instructed' | 'local';
  readonly keyHelpUrl: string;

  listModels(config: ModelConfig): ModelInfo[];
  validateKey(ctx: Pick<ProviderContext, 'apiKey' | 'fetch' | 'isWeb'>): Promise<KeyValidation>;
  mapEffort(model: string, effort: Effort): Record<string, unknown>;

  startAgentTask(req: AgentTaskRequest, ctx: ProviderContext): Promise<AgentTaskHandle>;
  /** Streams one turn until it completes, fails, pauses or needs approval. */
  streamEvents(handle: AgentTaskHandle, req: AgentTaskRequest, ctx: ProviderContext): AsyncIterable<AgentEvent>;
  /** Follow-up in the same sandbox (continue after pause, rebase instructions). */
  sendMessage(handle: AgentTaskHandle, text: string, req: AgentTaskRequest, ctx: ProviderContext): Promise<AgentTaskHandle>;
  respondToApproval(
    handle: AgentTaskHandle,
    approvalId: string,
    allow: boolean,
    req: AgentTaskRequest,
    ctx: ProviderContext,
  ): Promise<AgentTaskHandle>;
  pause(handle: AgentTaskHandle, ctx: ProviderContext): Promise<void>;
  cancel(handle: AgentTaskHandle, ctx: ProviderContext): Promise<void>;
  /** Polls a task that may have progressed while the app was closed. */
  pollStatus(handle: AgentTaskHandle, ctx: ProviderContext): Promise<AgentEvent[]>;
  collectChanges(handle: AgentTaskHandle, req: AgentTaskRequest, ctx: ProviderContext): Promise<ChangeSet>;
  /** Deletes the remote sandbox (after push/expiry) so no code lingers server-side. */
  disposeSandbox(handle: AgentTaskHandle, ctx: ProviderContext): Promise<void>;

  scanSandbox?(environmentId: string, ctx: ProviderContext): Promise<SandboxEntry[]>;
  cleanSandbox?(environmentId: string, paths: string[], ctx: ProviderContext): Promise<void>;
}

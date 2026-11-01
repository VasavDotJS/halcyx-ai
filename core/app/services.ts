import type { SupabaseClient } from '@supabase/supabase-js';
import { fetch as expoFetch } from 'expo/fetch';
import { Platform as RNPlatform } from 'react-native';
import { TaskRunner } from '@/core/agent/runner';
import { TaskStore } from '@/core/agent/taskStore';
import { createBackendApi, type BackendApi } from '@/core/backend/api';
import { createSupabase } from '@/core/backend/supabase';
import { StorageCleaner } from '@/core/cleaner/cleaner';
import { migrate } from '@/core/db/migrations';
import { createGitHubClient, type GitHub } from '@/core/github/client';
import { createExchange, type GitHubExchange } from '@/core/github/oauth';
import { listPaths, readFileAt } from '@/core/github/repos';
import { GitHubTokenManager } from '@/core/github/tokens';
import { cancelExpiryWarning, notifyLocal, scheduleExpiryWarning } from '@/core/notifications/notify';
import { OfflineQueue } from '@/core/offline/queue';
import { createFileStore } from '@/core/platform/files';
import { createSecretStore } from '@/core/platform/secrets';
import { openSqlDb } from '@/core/platform/sqlite';
import type { Platform } from '@/core/platform/types';
import type { FetchLike } from '@/core/providers/http';
import { BUNDLED_MODEL_CONFIG, type ModelConfig } from '@/core/providers/modelConfig';
import type { ProviderContext } from '@/core/providers/types';
import { KeyVault } from '@/core/security/keyVault';
import type { ProviderId } from '@/core/types';
import { UsageMeter } from '@/core/usage/meter';
import { recoverInterruptedPushes } from '@/core/workspace/pushFlow';
import { WorkspaceStore } from '@/core/workspace/store';
import { useSettings } from '@/state/settings';

export type Services = {
  platform: Platform;
  supabase: SupabaseClient;
  backend: BackendApi;
  keys: KeyVault;
  tasks: TaskStore;
  workspaces: WorkspaceStore;
  usage: UsageMeter;
  queue: OfflineQueue;
  cleaner: StorageCleaner;
  runner: TaskRunner;
  githubTokens: GitHubTokenManager;
  githubExchange: GitHubExchange;
  github: () => Promise<GitHub>;
  fetch: FetchLike;
  isWeb: boolean;
  models: () => ModelConfig;
  refreshModels: () => Promise<void>;
};

let instance: Promise<Services> | null = null;

/** expo/fetch supports streaming response bodies on iOS/Android (needed for SSE). */
const streamingFetch: FetchLike = (url, init) =>
  RNPlatform.OS === 'web' ? fetch(url, init) : (expoFetch(url, init as never) as unknown as Promise<Response>);

async function build(): Promise<Services> {
  const isWeb = RNPlatform.OS === 'web';
  const platform: Platform = { db: await openSqlDb(), files: createFileStore(), secrets: createSecretStore() };
  await migrate(platform.db);

  const supabase = createSupabase(platform.secrets);
  const backend = createBackendApi(supabase);
  const githubExchange = createExchange((name, body) => backend.invoke(name, body));
  const githubTokens = new GitHubTokenManager(platform.secrets, githubExchange);
  const github = async () => createGitHubClient(() => githubTokens.accessToken());

  const keys = new KeyVault(platform);
  const tasks = new TaskStore(platform);
  const workspaces = new WorkspaceStore(platform);
  const usage = new UsageMeter(platform.db);
  const queue = new OfflineQueue(platform);
  let modelConfig = BUNDLED_MODEL_CONFIG;

  const cache: ProviderContext['cache'] = {
    get: async (k) => (await platform.db.get<{ value: string }>('SELECT value FROM kv WHERE key = ?', [`cache.${k}`]))?.value ?? null,
    set: async (k, v) => {
      await platform.db.run('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', [`cache.${k}`, v]);
    },
  };

  const context = async (provider: ProviderId, taskId: string, repoFull: string, baseSha: () => string): Promise<ProviderContext> => {
    const apiKey = await keys.get(provider);
    if (!apiKey) throw new Error(`Add your ${provider} API key in Settings › API keys first.`);
    let paths: string[] | null = null;
    return {
      apiKey,
      fetch: streamingFetch,
      isWeb,
      cache,
      checkpoint: { load: () => tasks.checkpoint(taskId), save: (j) => tasks.saveCheckpoint(taskId, j) },
      repo: {
        list: async () => (paths ??= await listPaths(await github(), repoFull, baseSha())),
        read: async (path) => readFileAt(await github(), repoFull, baseSha(), path).catch(() => null),
      },
    };
  };

  const cleaner = new StorageCleaner(platform, workspaces, async (provider) => {
    const apiKey = await keys.get(provider);
    if (!apiKey) return null;
    return {
      apiKey,
      fetch: streamingFetch,
      isWeb,
      cache,
      checkpoint: { load: async () => null, save: async () => undefined },
      repo: { list: async () => [], read: async () => null },
    };
  });

  const runner = new TaskRunner({
    tasks,
    workspaces,
    usage,
    cleaner,
    settings: () => useSettings.getState(),
    models: () => modelConfig,
    github,
    scopedToken: async (repo) => githubExchange.scopedReadToken(await githubTokens.accessToken(), repo.id),
    context,
    notify: async (kind, taskId, title, body) => {
      if (!useSettings.getState().notifyOnFinish && kind === 'task_finished') return;
      await notifyLocal(platform.db, { kind, title, body, taskId });
      const t = await tasks.get(taskId);
      if (t) await backend.notifyOtherDevices({ kind, task_id: taskId, repo: t.repoFull }).catch(() => undefined);
    },
    scheduleExpiryWarning,
    report: (row) => backend.logTask(row),
  });

  const pushOriginal = runner.push.bind(runner);
  runner.push = async (workspaceId, opts) => {
    const out = await pushOriginal(workspaceId, opts);
    if (out.kind === 'pushed') await cancelExpiryWarning(workspaceId);
    return out;
  };

  const services: Services = {
    platform,
    supabase,
    backend,
    keys,
    tasks,
    workspaces,
    usage,
    queue,
    cleaner,
    runner,
    githubTokens,
    githubExchange,
    github,
    fetch: streamingFetch,
    isWeb,
    models: () => modelConfig,
    refreshModels: async () => {
      modelConfig = await backend.fetchModelConfig().catch(() => modelConfig);
    },
  };

  // Crash-safe startup: finish interrupted pushes, expire old workspaces, reattach tasks.
  if (await githubTokens.isConnected()) await recoverInterruptedPushes(workspaces, await github()).catch(() => undefined);
  await workspaces.expireDue();
  void services.refreshModels();
  void runner.resumeActive();
  return services;
}

export function services(): Promise<Services> {
  instance ??= build();
  return instance;
}

/** Privacy dashboard "wipe all local data": every workspace shredded, keys and caches gone. */
export async function wipeAllLocalData(): Promise<void> {
  const s = await services();
  await s.supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
  for (const w of await s.workspaces.listPending()) await s.workspaces.shred(w.id, 'discarded');
  for (const p of ['gemini', 'anthropic', 'openai'] as const) await s.keys.remove(p);
  await s.githubTokens.clear();
  for (const t of ['task_events', 'tasks', 'usage', 'queue', 'prompts', 'repo_settings', 'sandboxes', 'notifications', 'push_log', 'kv'])
    await s.platform.db.run(`DELETE FROM ${t}`);
  await s.platform.secrets.remove('device-data-key');
  await s.platform.files.removeDir('ws');
}

import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { services } from '@/core/app/services';
import { useSettings } from '@/state/settings';

/**
 * Agents keep running in the provider's cloud while the app is closed. This OS-scheduled task
 * (≈15 min minimum interval) checks their status directly with the provider — keys never leave
 * the device — then raises a local notification when a task finishes, fails or needs approval.
 * It also sweeps expired workspaces and runs auto-clean.
 */
export const BACKGROUND_TASK = 'halcyx.agent-poll';

TaskManager.defineTask(BACKGROUND_TASK, async () => {
  try {
    const s = await services();
    await s.runner.pollOnce();
    await s.workspaces.expireDue();
    const { autoClean, autoCleanDays } = useSettings.getState();
    if (autoClean) await s.cleaner.autoClean(autoCleanDays);
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundPolling(): Promise<void> {
  if (Platform.OS === 'web') return;
  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
  if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK)) return;
  await BackgroundTask.registerTaskAsync(BACKGROUND_TASK, { minimumInterval: 15 });
}

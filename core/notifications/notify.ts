import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';
import type { SqlDb } from '@/core/platform/types';
import { randomId } from '@/core/security/crypto';
import { WARN_BEFORE } from '@/core/workspace/store';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

export type NotificationRow = {
  id: string;
  title: string;
  body: string;
  kind: string;
  task_id: string | null;
  created_at: number;
  read: number;
};

/** Local notification + notification-center entry. Bodies never include code or prompts. */
export async function notifyLocal(db: SqlDb, n: { kind: string; title: string; body: string; taskId: string | null; route?: string }) {
  await db.run('INSERT INTO notifications (id, title, body, kind, task_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    randomId(8),
    n.title,
    n.body,
    n.kind,
    n.taskId,
    Date.now(),
  ]);
  if (Platform.OS === 'web') return;
  await Notifications.scheduleNotificationAsync({
    content: { title: n.title, body: n.body, data: { route: n.route ?? (n.taskId ? `/chat/${n.taskId}` : '/notifications') } },
    trigger: null,
  });
}

/** Schedules the "expires in 12h" reminder for a pending workspace. */
export async function scheduleExpiryWarning(workspaceId: string, expiresAt: number, repoFull: string): Promise<void> {
  if (Platform.OS === 'web') return;
  const at = expiresAt - WARN_BEFORE;
  if (at <= Date.now()) return;
  await Notifications.scheduleNotificationAsync({
    identifier: `expiry-${workspaceId}`,
    content: {
      title: 'Unpushed changes expire in 12 hours',
      body: `${repoFull}: review and push, or they will be erased.`,
      data: { route: `/review/${workspaceId}` },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at) },
  });
}

export async function cancelExpiryWarning(workspaceId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  await Notifications.cancelScheduledNotificationAsync(`expiry-${workspaceId}`).catch(() => undefined);
}

export async function listNotifications(db: SqlDb): Promise<NotificationRow[]> {
  return db.all<NotificationRow>('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 200');
}

export async function markAllRead(db: SqlDb): Promise<void> {
  await db.run('UPDATE notifications SET read = 1');
}

/** Expo push token for cross-device notifications (metadata only; sent via the `notify` function). */
export async function registerForPush(): Promise<string | null> {
  if (Platform.OS === 'web' || !Device.isDevice) return null;
  const existing = await Notifications.getPermissionsAsync();
  const status = existing.granted ? 'granted' : (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'Tasks', importance: AndroidImportance.DEFAULT });
  }
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  if (!projectId) return null;
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}

/** Optional monthly "review your provider usage & billing" reminder (local only). */
export async function syncBillingReminder(enabled: boolean): Promise<void> {
  if (Platform.OS === 'web') return;
  await Notifications.cancelScheduledNotificationAsync('billing-reminder').catch(() => undefined);
  if (!enabled) return;
  await Notifications.scheduleNotificationAsync({
    identifier: 'billing-reminder',
    content: {
      title: 'Review your API usage',
      body: 'Check usage and billing with your AI providers.',
      data: { route: '/settings/usage' },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.MONTHLY, day: 1, hour: 10, minute: 0 },
  });
}

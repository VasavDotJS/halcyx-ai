import * as Network from 'expo-network';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import type { Services } from '@/core/app/services';
import { syncBillingReminder } from '@/core/notifications/notify';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';

/**
 * Auto-lock after N minutes in the background, offline-queue flushing when connectivity
 * returns, notification deep links, and periodic expiry sweeps.
 */
export function useAppLifecycle(s: Services | null) {
  useEffect(() => {
    if (!s) return;
    const flush = () =>
      s.queue.flush({
        prompt: async (payload) => {
          await s.runner.start(payload as Parameters<typeof s.runner.start>[0]);
        },
        push: async (payload) => {
          const p = payload as { workspaceId: string; opts: Parameters<typeof s.runner.push>[1] };
          await s.runner.push(p.workspaceId, p.opts);
        },
      });

    const appSub = AppState.addEventListener('change', (state) => {
      const { appLock, autoLockMinutes } = useSettings.getState();
      const session = useSession.getState();
      if (state === 'background') session.touch();
      if (state === 'active') {
        if (appLock && Date.now() - session.lastActiveAt > autoLockMinutes * 60_000) session.lock();
        void s.workspaces.expireDue();
        void s.runner.resumeActive();
        void flush();
      }
    });
    const netSub = Network.addNetworkStateListener((n) => {
      if (n.isInternetReachable) void flush();
    });
    const notifSub = Notifications.addNotificationResponseReceivedListener((r) => {
      const route = r.notification.request.content.data?.route;
      if (typeof route === 'string') router.push(route as never);
    });
    const sweep = setInterval(() => void s.workspaces.expireDue(), 10 * 60_000);
    let billing = useSettings.getState().billingReminder;
    void syncBillingReminder(billing);
    const unsubSettings = useSettings.subscribe((st) => {
      if (st.billingReminder !== billing) {
        billing = st.billingReminder;
        void syncBillingReminder(billing);
      }
    });
    void flush();
    return () => {
      appSub.remove();
      netSub.remove();
      notifSub.remove();
      clearInterval(sweep);
      unsubSettings();
    };
  }, [s]);
}

export async function isOnline(): Promise<boolean> {
  const n = await Network.getNetworkStateAsync();
  return !!n.isInternetReachable;
}

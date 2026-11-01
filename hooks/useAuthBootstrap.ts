import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import type { Services } from '@/core/app/services';
import { registerForPush } from '@/core/notifications/notify';
import { randomId } from '@/core/security/crypto';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';

async function deviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem('halcyx.device-id');
  if (existing) return existing;
  const id = randomId(12);
  await AsyncStorage.setItem('halcyx.device-id', id);
  return id;
}

function sessionIdFromJwt(jwt: string): string | null {
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { session_id?: string };
    return payload.session_id ?? null;
  } catch {
    return null;
  }
}

/** Restores the Supabase session, registers this device, and two-way syncs preferences. */
export function useAuthBootstrap(s: Services | null) {
  const setSession = useSession((x) => x.setSession);
  const setReady = useSession((x) => x.setReady);
  const lock = useSession((x) => x.lock);
  const syncing = useRef(false);

  useEffect(() => {
    if (!s) return;
    let unsubSettings: (() => void) | null = null;

    const onSignedIn = async (accessToken: string) => {
      const id = await deviceId();
      if (await s.backend.isDeviceRevoked(id).catch(() => false)) {
        await s.supabase.auth.signOut({ scope: 'local' });
        return;
      }
      const remote = await s.backend.pullSettings().catch(() => null);
      if (remote) {
        syncing.current = true;
        useSettings.getState().applyRemote(remote);
        syncing.current = false;
      }
      await s.backend
        .registerDevice({
          device_id: id,
          name: (Device.deviceName ?? Device.modelName ?? Platform.OS).slice(0, 80).replace(/[\r\n]/g, ' '),
          platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
          push_token: await registerForPush().catch(() => null),
          app_version: Constants.expoConfig?.version ?? '1.0.0',
          session_id: sessionIdFromJwt(accessToken),
        })
        .catch(() => undefined);
      let timer: ReturnType<typeof setTimeout> | null = null;
      unsubSettings?.();
      unsubSettings = useSettings.subscribe((state) => {
        if (syncing.current) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void s.backend.pushSettings(state).catch(() => undefined), 1500);
      });
    };

    void s.supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) {
        if (useSettings.getState().appLock) lock();
        void onSignedIn(data.session.access_token);
      }
      setReady();
    });

    const { data } = s.supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (event === 'SIGNED_IN' && session) void onSignedIn(session.access_token);
      if (event === 'SIGNED_OUT') unsubSettings?.();
    });
    return () => {
      data.subscription.unsubscribe();
      unsubSettings?.();
    };
  }, [s, setSession, setReady, lock]);
}

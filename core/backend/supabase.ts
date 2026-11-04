import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { Platform as RNPlatform } from 'react-native';
import type { SecretStore } from '@/core/platform/types';
import { openLocal, sealLocal } from '@/core/security/dataKey';

/**
 * Supabase handles accounts, settings and metadata only. The auth session (refresh token)
 * is sealed with the device key before it touches AsyncStorage, because Keychain items are
 * too small for a full session blob.
 */
function sealedStorage(secrets: SecretStore) {
  const k = (key: string) => `sb.${key}`;
  return {
    async getItem(key: string) {
      const v = await AsyncStorage.getItem(k(key));
      if (!v) return null;
      try {
        return await openLocal(secrets, v, `supabase:${key}`);
      } catch {
        await AsyncStorage.removeItem(k(key));
        return null;
      }
    },
    async setItem(key: string, value: string) {
      await AsyncStorage.setItem(k(key), await sealLocal(secrets, value, `supabase:${key}`));
    },
    async removeItem(key: string) {
      await AsyncStorage.removeItem(k(key));
    },
  };
}

type Extra = { supabaseUrl?: string; supabaseAnonKey?: string };

/** Project URL and public (anon/publishable) key baked into the build. */
export function supabaseConfig(): { url: string; anonKey: string } {
  const extra = (Constants.expoConfig?.extra ?? {}) as Extra;
  const url = extra.supabaseUrl ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = extra.supabaseAnonKey ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('Supabase is not configured: set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  return { url, anonKey };
}

export function createSupabase(secrets: SecretStore): SupabaseClient {
  const { url, anonKey: anon } = supabaseConfig();
  return createClient(url, anon, {
    auth: {
      storage: sealedStorage(secrets),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: RNPlatform.OS === 'web',
      flowType: 'pkce',
    },
  });
}

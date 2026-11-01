import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_SETTINGS, SYNCED_FIELDS, type Settings } from '@/core/settings/types';

type SettingsStore = Settings & {
  update: (patch: Partial<Settings>) => void;
  applyRemote: (remote: Partial<Settings>) => void;
  reset: () => void;
};

/** Preferences only — never secrets. Synced fields are mirrored to Supabase by useSettingsSync. */
export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      update: (patch) => set(patch),
      applyRemote: (remote) => {
        const allowed: Partial<Settings> = {};
        for (const f of SYNCED_FIELDS) if (f in remote) (allowed as Record<string, unknown>)[f] = remote[f];
        set(allowed);
      },
      reset: () => set(DEFAULT_SETTINGS),
    }),
    { name: 'halcyx.settings', storage: createJSONStorage(() => AsyncStorage), version: 1 },
  ),
);

/** Settings export for the privacy dashboard (preferences only). */
export function exportSettings(): string {
  const s = useSettings.getState();
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) out[k] = s[k];
  return JSON.stringify({ app: 'HALCYX', exportedAt: new Date().toISOString(), settings: out }, null, 2);
}

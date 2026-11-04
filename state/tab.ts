import { Platform } from 'react-native';
import { create } from 'zustand';

/** URL flag a tab reloads into after a newer tab took over the local database (web only). */
export const ELSEWHERE_PARAM = 'elsewhere';

function startsSuspended(): boolean {
  if (Platform.OS !== 'web' || typeof globalThis.location === 'undefined') return false;
  return new URLSearchParams(globalThis.location.search).has(ELSEWHERE_PARAM);
}

/** Web only: true when another tab owns the local database, so this tab must not open it. */
export const useTabState = create<{ suspended: boolean }>(() => ({ suspended: startsSuspended() }));

/**
 * Steps aside for a newer tab. Reloading (rather than just closing the database) is what frees the
 * storage: the SQLite worker keeps its file handles until the page that started it unloads.
 */
export function yieldToNewerTab(): void {
  useTabState.setState({ suspended: true });
  const url = new URL(globalThis.location.href);
  url.searchParams.set(ELSEWHERE_PARAM, '1');
  url.hash = '';
  globalThis.location.replace(url.toString());
}

/** "Use HALCYX here": reload without the flag; this tab then takes the database back. */
export function reclaimFromOtherTab(): void {
  const url = new URL(globalThis.location.href);
  url.searchParams.delete(ELSEWHERE_PARAM);
  globalThis.location.replace(url.toString());
}

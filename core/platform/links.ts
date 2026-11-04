import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

/**
 * Absolute URL for an in-app route, used for auth redirects.
 * On web, `Linking.createURL` ignores the deploy base path (e.g. GitHub Pages serves the app
 * under /halcyx-ai), so the base inlined by Expo from `experiments.baseUrl` is added here.
 */
export function appUrl(path: string, base = process.env.EXPO_BASE_URL ?? ''): string {
  if (Platform.OS !== 'web') return Linking.createURL(path);
  const prefix = base.replace(/\/+$/, '');
  return new URL(`${prefix}/${path.replace(/^\/+/, '')}`, globalThis.location.origin).toString();
}

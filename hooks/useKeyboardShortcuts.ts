import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

export const SHORTCUTS: { keys: string; action: string; href: string }[] = [
  { keys: '1', action: 'Chat', href: '/(tabs)/chat' },
  { keys: '2', action: 'Projects', href: '/(tabs)/projects' },
  { keys: '3', action: 'Review', href: '/(tabs)/review' },
  { keys: '4', action: 'Settings', href: '/(tabs)/settings' },
  { keys: 'k', action: 'New task', href: '/(tabs)/chat' },
  { keys: ',', action: 'Settings', href: '/(tabs)/settings' },
];

/** Resolves a key event to a route, or null. ⌘ on Apple platforms, Ctrl elsewhere. */
export function shortcutFor(e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean }): string | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return null;
  return SHORTCUTS.find((s) => s.keys === e.key.toLowerCase())?.href ?? null;
}

/**
 * Global shortcuts for the PWA and hardware keyboards in browsers (iPad Safari, desktop).
 * ⌘/Ctrl+Enter to send lives in the Composer and also works on native hardware keyboards.
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      const href = shortcutFor(e);
      if (!href) return;
      e.preventDefault();
      router.navigate(href as never);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}

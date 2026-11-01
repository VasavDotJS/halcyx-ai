import { vars } from 'nativewind';
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { useColorScheme, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useSettings } from '@/state/settings';
import { resolveThemeName, type Theme, themeVars, THEMES, withAccent } from './themes';

export type ActiveTheme = Theme & { reduceMotion: boolean };

const ThemeContext = createContext<ActiveTheme>({ ...THEMES.midnight, reduceMotion: false });

/**
 * Token-driven theming: the active theme is exposed as CSS variables (for NativeWind classes)
 * and as a JS object (for SVG, icons, StatusBar). Changing the setting re-renders instantly.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const pref = useSettings((s) => s.theme);
  const accent = useSettings((s) => s.accent);
  const reduceMotion = useReducedMotion();

  const theme = useMemo<ActiveTheme>(() => {
    const base = THEMES[resolveThemeName(pref, scheme !== 'light')];
    return { ...withAccent(base, accent), reduceMotion };
  }, [pref, scheme, accent, reduceMotion]);

  const style = useMemo(() => vars(themeVars(theme)), [theme]);

  return (
    <ThemeContext.Provider value={theme}>
      <View style={[style, { flex: 1, backgroundColor: theme.colors.bg }]}>{children}</View>
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);

/** Motion duration that collapses to 0 when the OS asks for reduced motion. */
export function useMotion(kind: 'fast' | 'base' | 'slow' = 'base'): number {
  const t = useTheme();
  return t.reduceMotion ? 0 : t.motion[kind];
}

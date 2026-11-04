import { DarkTheme, ThemeProvider as NavigationThemeProvider, Redirect, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSession } from '@/state/session';
import { ThemeProvider } from '@/ui/ThemeProvider';
import { AuthBackdrop } from '@/ui/waves/AuthBackdrop';

/**
 * Sign-in / sign-up live on a pitch-black stage with rippling silk behind them, always in the
 * dark theme (independent of the user's theme setting).
 */
/** Navigation's own scene backgrounds must be transparent, or they cover the shader on web. */
const TRANSPARENT_NAV = { ...DarkTheme, colors: { ...DarkTheme.colors, background: 'transparent', card: 'transparent' } };

export default function AuthLayout() {
  const session = useSession((s) => s.session);
  if (session) return <Redirect href="/" />;
  return (
    <ThemeProvider force="midnight" pitchBlack transparent>
      <StatusBar style="light" />
      <AuthBackdrop>
        <NavigationThemeProvider value={TRANSPARENT_NAV}>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' }, animation: 'fade' }} />
        </NavigationThemeProvider>
      </AuthBackdrop>
    </ThemeProvider>
  );
}

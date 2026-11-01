import { Stack } from 'expo-router';
import { useTheme } from './ThemeProvider';

/** Shared themed stack used by every tab. */
export function ThemedStack() {
  const t = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.colors.bg },
        headerTintColor: t.colors.fg,
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: t.font.semibold, fontSize: 17 },
        headerLargeTitle: false,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: t.colors.bg },
        animation: t.reduceMotion ? 'none' : 'default',
      }}
    />
  );
}

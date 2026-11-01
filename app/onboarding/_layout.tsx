import { Redirect, Stack } from 'expo-router';
import { useSession } from '@/state/session';
import { useTheme } from '@/ui/ThemeProvider';

export default function OnboardingLayout() {
  const t = useTheme();
  const session = useSession((s) => s.session);
  if (!session) return <Redirect href="/(auth)/sign-in" />;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.colors.bg },
        headerTintColor: t.colors.fg,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: t.colors.bg },
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="key" options={{ title: 'Step 1 of 4 · API key' }} />
      <Stack.Screen name="github" options={{ title: 'Step 2 of 4 · GitHub' }} />
      <Stack.Screen name="repo" options={{ title: 'Step 3 of 4 · Repository' }} />
      <Stack.Screen name="first-task" options={{ title: 'Step 4 of 4 · First task' }} />
    </Stack>
  );
}

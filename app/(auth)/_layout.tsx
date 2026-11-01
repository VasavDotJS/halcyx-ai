import { Redirect, Stack } from 'expo-router';
import { useSession } from '@/state/session';
import { useTheme } from '@/ui/ThemeProvider';

export default function AuthLayout() {
  const t = useTheme();
  const session = useSession((s) => s.session);
  if (session) return <Redirect href="/" />;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.colors.bg },
        headerTintColor: t.colors.fg,
        headerShadowVisible: false,
        headerTitle: '',
        contentStyle: { backgroundColor: t.colors.bg },
      }}
    >
      <Stack.Screen name="sign-in" options={{ headerShown: false }} />
    </Stack>
  );
}

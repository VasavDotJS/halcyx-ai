import '../global.css';
import { Geist_400Regular, Geist_500Medium, Geist_600SemiBold, useFonts } from '@expo-google-fonts/geist';
import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
// Importing this module also registers the background task definition (TaskManager.defineTask).
import { registerBackgroundPolling } from '@/core/agent/background';
import { initSentry, Sentry } from '@/core/monitoring/sentry';
import { installCrypto } from '@/core/security/installCrypto';
import { useAppLifecycle } from '@/hooks/useAppLifecycle';
import { useServicesState } from '@/hooks/useServices';
import { BootError } from '@/ui/BootError';
import { useAuthBootstrap } from '@/hooks/useAuthBootstrap';
import { useSession } from '@/state/session';
import { LockScreen } from '@/ui/LockScreen';
import { ThemeProvider, useTheme } from '@/ui/ThemeProvider';

installCrypto();
initSentry();
void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, networkMode: 'offlineFirst', staleTime: 15_000 } },
});

function Shell() {
  const t = useTheme();
  const { services: s, error } = useServicesState();
  const ready = useSession((x) => x.ready);
  const locked = useSession((x) => x.locked);
  useAuthBootstrap(s);
  useAppLifecycle(s);

  useEffect(() => {
    if (s && ready) {
      void SplashScreen.hideAsync();
      void registerBackgroundPolling();
    }
    if (error) void SplashScreen.hideAsync();
  }, [s, ready, error]);

  if (error) return <BootError error={error} />;
  if (!s || !ready) return null;
  return (
    <>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.colors.bg },
          headerTintColor: t.colors.fg,
          headerShadowVisible: false,
          headerTitleStyle: { fontFamily: t.font.semibold, fontSize: 17 },
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: t.colors.bg },
          animation: t.reduceMotion ? 'none' : 'default',
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="keys/[provider]" options={{ title: 'API key', presentation: 'modal' }} />
        <Stack.Screen name="preview" options={{ title: 'Live preview' }} />
        <Stack.Screen name="compare/[groupId]" options={{ title: 'Compare agents' }} />
        <Stack.Screen name="auth-callback" options={{ headerShown: false }} />
      </Stack>
      {locked ? <LockScreen /> : null}
    </>
  );
}

function RootLayout() {
  const [fontsLoaded] = useFonts({ Geist_400Regular, Geist_500Medium, Geist_600SemiBold, GeistMono_400Regular });
  if (!fontsLoaded) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <Shell />
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(RootLayout);

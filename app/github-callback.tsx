import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { completeWebGitHubConnect } from '@/core/github/connect';
import { useServices } from '@/hooks/useServices';
import { Button, Text } from '@/ui/primitives';

/**
 * Redirect target for the GitHub App OAuth flow. On native the auth session intercepts the URL
 * before this renders. On web (full-page redirect) this finishes the code exchange.
 */
export default function GitHubCallback() {
  const s = useServices();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      router.replace('/');
      return;
    }
    if (!s) return;
    let alive = true;
    completeWebGitHubConnect(s, globalThis.location.href)
      .then((next) => alive && router.replace(next as never))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [s]);

  return (
    <View className="flex-1 items-center justify-center gap-4 bg-bg px-8">
      {error ? (
        <>
          <Text tone="danger" className="text-center" accessibilityLiveRegion="assertive">
            {error}
          </Text>
          <Button title="Back to Projects" variant="secondary" onPress={() => router.replace('/(tabs)/projects')} />
        </>
      ) : (
        <ActivityIndicator accessibilityLabel="Connecting GitHub" />
      )}
    </View>
  );
}

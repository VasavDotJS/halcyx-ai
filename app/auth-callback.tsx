import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { completeFromUrl, friendlyAuthError } from '@/core/auth/auth';
import { useReadyServices } from '@/hooks/useServices';
import { Button, Text } from '@/ui/primitives';

/** Landing route for magic links, OAuth and password-recovery redirects. */
export default function AuthCallback() {
  const s = useReadyServices();
  const url = Linking.useURL();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    completeFromUrl(s.supabase, url)
      .then((kind) => router.replace(kind === 'recovery' ? '/reset-password' : '/'))
      .catch((e) => setError(friendlyAuthError(e) || 'Sign-in was cancelled.'));
  }, [url, s]);

  return (
    <View className="flex-1 items-center justify-center gap-4 bg-bg px-8">
      {error ? (
        <>
          <Text tone="danger" className="text-center">
            {error}
          </Text>
          <Button title="Back to sign in" onPress={() => router.replace('/(auth)/sign-in')} />
        </>
      ) : (
        <ActivityIndicator accessibilityLabel="Signing in" />
      )}
    </View>
  );
}

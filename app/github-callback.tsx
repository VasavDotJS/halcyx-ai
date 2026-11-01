import { router } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

/**
 * Redirect target for the GitHub App OAuth flow. On native the auth session intercepts the
 * URL before this renders; on web the popup lands here and closes itself.
 */
export default function GitHubCallback() {
  useEffect(() => {
    const t = setTimeout(() => {
      if (typeof window !== 'undefined' && window.opener) window.close();
      else router.replace('/');
    }, 400);
    return () => clearTimeout(t);
  }, []);
  return (
    <View className="flex-1 items-center justify-center bg-bg">
      <ActivityIndicator accessibilityLabel="Connecting GitHub" />
    </View>
  );
}

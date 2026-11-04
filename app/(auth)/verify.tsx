import { useLocalSearchParams } from 'expo-router';
import { MailCheck } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import { friendlyAuthError, resendVerification } from '@/core/auth/auth';
import { useReadyServices } from '@/hooks/useServices';
import { Button, Screen, Text } from '@/ui/primitives';
import { useTheme } from '@/ui/ThemeProvider';
import { AuthHeader } from '@/ui/waves/AuthHeader';

export default function Verify() {
  const s = useReadyServices();
  const t = useTheme();
  const { email } = useLocalSearchParams<{ email: string }>();
  const [state, setState] = useState<string | null>(null);
  return (
    <Screen narrow transparent edges={['top', 'bottom']}>
      <AuthHeader />
      <View className="items-center gap-3 py-8">
        <MailCheck size={36} color={t.colors.accent} />
        <Text variant="title" accessibilityRole="header">
          Verify your email
        </Text>
        <Text tone="muted" className="text-center">
          We sent a link to {email}. Open it on this device to finish signing up.
        </Text>
      </View>
      <Button
        title="Resend email"
        variant="secondary"
        onPress={async () => {
          try {
            await resendVerification(s.supabase, email ?? '');
            setState('Sent again.');
          } catch (e) {
            setState(friendlyAuthError(e));
          }
        }}
      />
      {state ? (
        <Text tone="muted" className="text-center" accessibilityLiveRegion="polite">
          {state}
        </Text>
      ) : null}
    </Screen>
  );
}

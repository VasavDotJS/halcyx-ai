import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { friendlyAuthError, requestPasswordReset } from '@/core/auth/auth';
import { useReadyServices } from '@/hooks/useServices';
import { Button, Input, Screen, Text } from '@/ui/primitives';

export default function Forgot() {
  const s = useReadyServices();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <Screen narrow>
      <Text variant="title" accessibilityRole="header">
        Reset password
      </Text>
      <Input label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
      <Button
        title="Send reset link"
        full
        loading={busy}
        disabled={!email}
        onPress={async () => {
          setBusy(true);
          try {
            await requestPasswordReset(s.supabase, email);
            setMsg({ ok: true, text: 'If an account exists, a reset link is on its way.' });
          } catch (e) {
            setMsg({ ok: false, text: friendlyAuthError(e) });
          } finally {
            setBusy(false);
          }
        }}
      />
      {msg ? (
        <Text tone={msg.ok ? 'success' : 'danger'} accessibilityLiveRegion="polite">
          {msg.text}
        </Text>
      ) : null}
    </Screen>
  );
}

import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { friendlyAuthError, updatePassword } from '@/core/auth/auth';
import { useReadyServices } from '@/hooks/useServices';
import { Button, Input, Screen, Text } from '@/ui/primitives';

export default function ResetPassword() {
  const s = useReadyServices();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Screen narrow>
      <Stack.Screen options={{ title: 'New password' }} />
      <Text tone="muted">Choose a new password for your HALCYX account.</Text>
      <Input
        label="New password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
      />
      {error ? <Text tone="danger">{error}</Text> : null}
      <Button
        title="Save password"
        full
        loading={busy}
        disabled={password.length < 10}
        onPress={async () => {
          setBusy(true);
          try {
            await updatePassword(s.supabase, password);
            router.replace('/');
          } catch (e) {
            setError(friendlyAuthError(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </Screen>
  );
}

import { router } from 'expo-router';
import { useState } from 'react';
import { friendlyAuthError, signUp } from '@/core/auth/auth';
import { useReadyServices } from '@/hooks/useServices';
import { Button, Input, Screen, Text } from '@/ui/primitives';

export default function SignUp() {
  const s = useReadyServices();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const weak = password.length > 0 && password.length < 10;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const { needsVerification } = await signUp(s.supabase, email, password);
      if (needsVerification) router.replace({ pathname: '/(auth)/verify', params: { email } });
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen narrow>
      <Text variant="title" accessibilityRole="header">
        Create your account
      </Text>
      <Text tone="muted">Your account stores preferences only. API keys and code stay on this device.</Text>
      <Input label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <Input
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        error={weak ? 'Use at least 10 characters.' : null}
      />
      {error ? <Text tone="danger">{error}</Text> : null}
      <Button title="Create account" full loading={busy} disabled={!email || password.length < 10} onPress={submit} />
    </Screen>
  );
}

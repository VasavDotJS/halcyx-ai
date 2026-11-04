import { Link, router } from 'expo-router';
import { useState } from 'react';
import { AccountExistsError, friendlyAuthError, signUp } from '@/core/auth/auth';
import { useReadyServices } from '@/hooks/useServices';
import { View } from 'react-native';
import { Button, Input, Screen, Text } from '@/ui/primitives';
import { AuthHeader } from '@/ui/waves/AuthHeader';

export default function SignUp() {
  const s = useReadyServices();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exists, setExists] = useState(false);
  const weak = password.length > 0 && password.length < 10;

  const submit = async () => {
    setBusy(true);
    setError(null);
    setExists(false);
    try {
      const { needsVerification } = await signUp(s.supabase, email, password);
      if (needsVerification) router.replace({ pathname: '/(auth)/verify', params: { email } });
    } catch (e) {
      setExists(e instanceof AccountExistsError);
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen narrow transparent edges={['top', 'bottom']}>
      <AuthHeader />
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
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      {exists ? (
        <View className="flex-row justify-between">
          <Link href="/(auth)/sign-in" className="py-2 font-medium text-accent">
            Sign in
          </Link>
          <Link href={{ pathname: '/(auth)/forgot', params: { email } }} className="py-2 font-medium text-accent">
            Forgot password?
          </Link>
        </View>
      ) : null}
      <Button title="Create account" full loading={busy} disabled={!email || password.length < 10} onPress={submit} />
    </Screen>
  );
}

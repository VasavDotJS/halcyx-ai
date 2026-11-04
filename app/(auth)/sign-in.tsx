import { useQuery } from '@tanstack/react-query';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Link } from 'expo-router';
import { GitBranch, Mail } from 'lucide-react-native';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { friendlyAuthError, sendMagicLink, signInWithApple, signInWithOAuth, signInWithPassword } from '@/core/auth/auth';
import { FALLBACK_PROVIDERS, fetchAuthProviders } from '@/core/auth/providers';
import { supabaseConfig } from '@/core/backend/supabase';
import { useReadyServices } from '@/hooks/useServices';
import { Logo } from '@/ui/Logo';
import { Button, Divider, Input, Screen, Segmented, Text } from '@/ui/primitives';
import { useTheme } from '@/ui/ThemeProvider';

export default function SignIn() {
  const s = useReadyServices();
  const t = useTheme();
  const [mode, setMode] = useState<'password' | 'magic'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Only offer sign-in methods the backend has enabled (avoids "provider is not enabled").
  const providers = useQuery({
    queryKey: ['auth-providers'],
    queryFn: () => {
      const { url, anonKey } = supabaseConfig();
      return fetchAuthProviders(url, anonKey);
    },
    staleTime: 10 * 60_000,
  });
  const p = providers.data ?? FALLBACK_PROVIDERS;
  const anySocial = p.apple || p.google || p.github;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      const msg = friendlyAuthError(e);
      if (msg) setError(msg);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen narrow edges={['top', 'bottom']}>
      <View className="items-center gap-3 pb-4 pt-10">
        <Logo height={30} />
        <Text tone="muted" className="text-center">
          Run coding agents from anywhere. Review, push, erase.
        </Text>
      </View>

      {anySocial ? (
        <View className="gap-2">
          {!p.apple ? null : Platform.OS === 'ios' ? (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              buttonStyle={
                t.dark ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
              }
              cornerRadius={t.radius.md}
              style={{ height: 46 }}
              onPress={() => run('apple', () => signInWithApple(s.supabase))}
            />
          ) : (
            <Button
              title="Continue with Apple"
              variant="secondary"
              loading={busy === 'apple'}
              onPress={() => run('apple', () => signInWithApple(s.supabase))}
            />
          )}
          {p.google ? (
            <Button
              title="Continue with Google"
              variant="secondary"
              loading={busy === 'google'}
              onPress={() => run('google', () => signInWithOAuth(s.supabase, 'google'))}
            />
          ) : null}
          {p.github ? (
            <Button
              title="Continue with GitHub"
              variant="secondary"
              icon={GitBranch}
              loading={busy === 'github'}
              onPress={() => run('github', () => signInWithOAuth(s.supabase, 'github'))}
            />
          ) : null}
        </View>
      ) : null}

      {anySocial ? (
        <View className="flex-row items-center gap-3 py-2">
          <View className="flex-1">
            <Divider />
          </View>
          <Text variant="caption" tone="muted">
            or with email
          </Text>
          <View className="flex-1">
            <Divider />
          </View>
        </View>
      ) : null}

      <Segmented
        label="Sign-in method"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'password', label: 'Password' },
          { value: 'magic', label: 'Magic link' },
        ]}
      />
      <Input
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      {mode === 'password' ? (
        <Input
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
        />
      ) : null}
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      {notice ? (
        <Text tone="success" accessibilityLiveRegion="polite">
          {notice}
        </Text>
      ) : null}
      {mode === 'password' ? (
        <Button
          title="Sign in"
          full
          loading={busy === 'password'}
          disabled={!email || !password}
          onPress={() => run('password', () => signInWithPassword(s.supabase, email, password))}
        />
      ) : (
        <Button
          title="Email me a sign-in link"
          icon={Mail}
          full
          loading={busy === 'magic'}
          disabled={!email}
          onPress={() =>
            run('magic', async () => {
              await sendMagicLink(s.supabase, email);
              setNotice('Check your inbox — the link signs you in on this device.');
            })
          }
        />
      )}

      <View className="flex-row justify-between px-1 pt-2">
        <Link href="/(auth)/sign-up" accessibilityRole="link">
          <Text tone="accent">Create account</Text>
        </Link>
        <Link href="/(auth)/forgot" accessibilityRole="link">
          <Text tone="accent">Forgot password?</Text>
        </Link>
      </View>
    </Screen>
  );
}

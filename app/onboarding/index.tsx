import { router } from 'expo-router';
import { Cloud, GitPullRequest, ShieldCheck } from 'lucide-react-native';
import { View } from 'react-native';
import { Logo } from '@/ui/Logo';
import { Button, Screen, Text } from '@/ui/primitives';
import { useTheme } from '@/ui/ThemeProvider';

const POINTS = [
  { icon: Cloud, title: 'Agents run in the cloud', body: 'In your provider’s isolated sandbox — not on your phone.' },
  { icon: GitPullRequest, title: 'You review every change', body: 'Diffs, per-hunk accept/reject, then one-tap push or PR.' },
  { icon: ShieldCheck, title: 'Your keys and code stay yours', body: 'Keys live in this device’s keystore. Code is erased after push.' },
];

export default function Welcome() {
  const t = useTheme();
  return (
    <Screen narrow edges={['top', 'bottom']}>
      <View className="gap-3 pt-12">
        <Logo height={28} />
        <Text variant="display" accessibilityRole="header">
          Your cockpit for coding agents.
        </Text>
        <Text tone="muted">About a minute to set up: add a key, connect GitHub, pick a repo, ship a first task.</Text>
      </View>
      <View className="gap-4 py-6">
        {POINTS.map((p) => (
          <View key={p.title} className="flex-row gap-3">
            <p.icon size={20} color={t.colors.accent} strokeWidth={1.75} />
            <View className="flex-1">
              <Text variant="label">{p.title}</Text>
              <Text tone="muted">{p.body}</Text>
            </View>
          </View>
        ))}
      </View>
      <Button title="Get started" full onPress={() => router.push('/onboarding/key')} />
    </Screen>
  );
}

import { router } from 'expo-router';
import { GitBranch } from 'lucide-react-native';
import { useState } from 'react';
import { connectGitHub } from '@/core/github/connect';
import { useReadyServices } from '@/hooks/useServices';
import { useSettings } from '@/state/settings';
import { Button, Card, Screen, Text } from '@/ui/primitives';

export default function OnboardingGitHub() {
  const s = useReadyServices();
  const update = useSettings((st) => st.update);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Screen narrow>
      <Text variant="title" accessibilityRole="header">
        Connect GitHub
      </Text>
      <Card className="gap-2">
        <Text>HALCYX uses a GitHub App with per-repository permissions. You choose exactly which repos it can see.</Text>
        <Text tone="muted">
          The agent’s sandbox only ever gets a short-lived, read-only token for the one repo it works on. Pushes happen from this device
          after you review.
        </Text>
      </Card>
      {error ? <Text tone="danger">{error}</Text> : null}
      <Button
        title="Connect GitHub"
        icon={GitBranch}
        full
        loading={busy}
        onPress={async () => {
          setBusy(true);
          setError(null);
          try {
            if (await connectGitHub(s)) router.push('/onboarding/repo');
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button
        title="Skip for now"
        variant="ghost"
        onPress={() => {
          update({ onboarded: true });
          router.replace('/(tabs)/projects');
        }}
      />
      <Text variant="caption" tone="muted" className="text-center">
        You can connect GitHub later from Projects.
      </Text>
    </Screen>
  );
}

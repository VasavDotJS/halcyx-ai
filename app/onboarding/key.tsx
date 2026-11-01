import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { GoogleKeyConcierge } from '@/ui/KeyConcierge';
import { Button, Screen, Text } from '@/ui/primitives';

export default function OnboardingKey() {
  const qc = useQueryClient();
  return (
    <Screen narrow>
      <Text variant="title" accessibilityRole="header">
        Add your Gemini key
      </Text>
      <GoogleKeyConcierge
        onDone={() => {
          void qc.invalidateQueries({ queryKey: ['keys'] });
          router.push('/onboarding/github');
        }}
      />
      <Button title="I’ll use Claude or OpenAI instead" variant="ghost" onPress={() => router.push('/keys/anthropic')} />
    </Screen>
  );
}

import { router } from 'expo-router';
import { Screen, Text } from '@/ui/primitives';
import { RepoList } from '@/ui/RepoList';

export default function OnboardingRepo() {
  return (
    <Screen narrow scroll={false}>
      <Text variant="title" accessibilityRole="header">
        Pick a repository
      </Text>
      <RepoList onSelect={(r) => router.push({ pathname: '/onboarding/first-task', params: { repo: JSON.stringify(r) } })} />
    </Screen>
  );
}

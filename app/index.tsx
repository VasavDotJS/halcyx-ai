import { Redirect } from 'expo-router';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';

export default function Index() {
  const session = useSession((s) => s.session);
  const onboarded = useSettings((s) => s.onboarded);
  if (!session) return <Redirect href="/(auth)/sign-in" />;
  if (!onboarded) return <Redirect href="/onboarding" />;
  return <Redirect href="/(tabs)/chat" />;
}

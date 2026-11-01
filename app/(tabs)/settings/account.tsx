import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { GitBranch, LogOut, UserX } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Platform } from 'react-native';
import { wipeAllLocalData } from '@/core/app/services';
import { connectGitHub, disconnectGitHub, manageRepoAccess } from '@/core/github/connect';
import { authenticate } from '@/core/security/biometrics';
import { useReadyServices } from '@/hooks/useServices';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { Button, Card, ListRow, Screen, Section, Text } from '@/ui/primitives';

function confirmDelete(): Promise<boolean> {
  const body =
    'This permanently deletes your HALCYX account, preferences, device list and task log, and wipes this device. GitHub and provider accounts are not affected.';
  if (Platform.OS === 'web') return Promise.resolve(globalThis.confirm?.(body) ?? false);
  return new Promise((resolve) =>
    Alert.alert('Delete account?', body, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}

export default function Account() {
  const s = useReadyServices();
  const session = useSession((x) => x.session);
  const reset = useSettings((x) => x.reset);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gh = useQuery({ queryKey: ['github-connected'], queryFn: () => s.githubTokens.isConnected() });

  return (
    <Screen title="Account">
      <Card>
        <Text variant="label">{session?.user.email ?? 'Signed in'}</Text>
        <Text variant="caption" tone="muted">
          {session?.user.app_metadata?.provider ? `via ${session.user.app_metadata.provider}` : ''}
        </Text>
      </Card>
      <Section title="GitHub">
        {gh.data ? (
          <>
            <ListRow icon={GitBranch} label="Manage repository access" onPress={() => void manageRepoAccess()} />
            <ListRow
              icon={GitBranch}
              label="Disconnect GitHub"
              tone="danger"
              last
              onPress={async () => {
                await disconnectGitHub(s);
                void gh.refetch();
              }}
            />
          </>
        ) : (
          <ListRow
            icon={GitBranch}
            label="Connect GitHub"
            last
            onPress={async () => {
              try {
                await connectGitHub(s);
                void gh.refetch();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          />
        )}
      </Section>
      {error ? <Text tone="danger">{error}</Text> : null}
      <Button
        title="Sign out"
        variant="secondary"
        icon={LogOut}
        loading={busy === 'out'}
        onPress={async () => {
          setBusy('out');
          await s.supabase.auth.signOut({ scope: 'local' });
          setBusy(null);
          router.replace('/(auth)/sign-in');
        }}
      />
      <Button
        title="Delete account"
        variant="danger"
        icon={UserX}
        loading={busy === 'delete'}
        onPress={async () => {
          if (!(await confirmDelete())) return;
          if (!(await authenticate('Confirm account deletion'))) return;
          setBusy('delete');
          try {
            await s.backend.deleteAccount();
            await wipeAllLocalData();
            reset();
            router.replace('/(auth)/sign-in');
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(null);
          }
        }}
      />
    </Screen>
  );
}

import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { GitBranch } from 'lucide-react-native';
import { useState } from 'react';
import { connectGitHub } from '@/core/github/connect';
import { useReadyServices } from '@/hooks/useServices';
import { Button, EmptyState, Screen, Text } from '@/ui/primitives';
import { RepoList } from '@/ui/RepoList';

export default function Projects() {
  const s = useReadyServices();
  const connected = useQuery({ queryKey: ['github-connected'], queryFn: () => s.githubTokens.isConnected() });
  const [error, setError] = useState<string | null>(null);

  if (connected.data === false) {
    return (
      <Screen title="Projects">
        <EmptyState
          title="Connect GitHub"
          body="Browse repositories, branches, pull requests and CI from here."
          action={
            <Button
              title="Connect GitHub"
              icon={GitBranch}
              onPress={async () => {
                try {
                  await connectGitHub(s);
                  void connected.refetch();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            />
          }
        />
        {error ? <Text tone="danger">{error}</Text> : null}
      </Screen>
    );
  }
  return (
    <Screen title="Projects" scroll={false}>
      <RepoList onSelect={(r) => router.push({ pathname: '/(tabs)/projects/[owner]/[repo]', params: { owner: r.owner, repo: r.name } })} />
    </Screen>
  );
}

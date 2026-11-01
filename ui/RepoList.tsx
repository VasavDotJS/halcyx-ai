import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { Lock, Search } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import { manageRepoAccess } from '@/core/github/connect';
import { filterRepos, listAccessibleRepos } from '@/core/github/repos';
import type { RepoRef } from '@/core/types';
import { useReadyServices } from '@/hooks/useServices';
import { Button, EmptyState, Text } from './primitives';
import { useTheme } from './ThemeProvider';

/** Searchable list of repositories the GitHub App can access. */
export function RepoList({ onSelect }: { onSelect: (r: RepoRef) => void }) {
  const s = useReadyServices();
  const t = useTheme();
  const [query, setQuery] = useState('');
  const repos = useQuery({ queryKey: ['repos'], queryFn: async () => listAccessibleRepos(await s.github()) });
  const shown = useMemo(() => filterRepos(repos.data ?? [], query), [repos.data, query]);

  if (repos.isLoading) return <ActivityIndicator accessibilityLabel="Loading repositories" className="py-10" />;
  if (repos.error) return <Text tone="danger">{(repos.error as Error).message}</Text>;
  if (!repos.data?.length) {
    return (
      <EmptyState
        title="No repositories yet"
        body="Grant the HALCYX GitHub App access to one or more repositories."
        action={<Button title="Choose repositories" onPress={() => void manageRepoAccess().then(() => repos.refetch())} />}
      />
    );
  }
  return (
    <View className="min-h-[400px] flex-1 gap-3">
      <View className="min-h-[44px] flex-row items-center gap-2 rounded-md border-hairline border-hairline bg-surface px-3">
        <Search size={16} color={t.colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search repositories"
          placeholderTextColor={t.colors.muted}
          accessibilityLabel="Search repositories"
          autoCapitalize="none"
          className="flex-1 font-sans text-[15px] text-fg"
        />
      </View>
      <FlashList
        data={shown}
        keyExtractor={(r) => String(r.id)}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.owner}/${item.name}${item.private ? ', private' : ''}`}
            onPress={() => onSelect(item)}
            className="min-h-[56px] flex-row items-center gap-2 border-b-hairline border-hairline px-1 py-3 active:bg-surface"
          >
            <View className="flex-1">
              <Text variant="label">{item.name}</Text>
              <Text variant="caption" tone="muted">
                {item.owner} · {item.defaultBranch}
              </Text>
            </View>
            {item.private ? <Lock size={14} color={t.colors.muted} /> : null}
          </Pressable>
        )}
      />
      <Button
        title="Manage repository access"
        variant="ghost"
        size="sm"
        onPress={() => void manageRepoAccess().then(() => repos.refetch())}
      />
    </View>
  );
}

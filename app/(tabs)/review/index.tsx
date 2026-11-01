import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useReadyServices } from '@/hooks/useServices';
import { Countdown } from '@/ui/Countdown';
import { Badge, EmptyState, Screen, Text } from '@/ui/primitives';
import { relativeTime } from '@/ui/TaskList';

export default function ReviewList() {
  const s = useReadyServices();
  const pending = useQuery({ queryKey: ['workspaces'], queryFn: () => s.workspaces.listPending(), refetchInterval: 10_000 });
  const log = useQuery({ queryKey: ['push-log'], queryFn: () => s.workspaces.pushLog(10) });
  return (
    <Screen title="Review">
      <Text variant="caption" tone="muted" className="uppercase tracking-widest">
        Pending · encrypted on this device
      </Text>
      {pending.data?.length ? (
        pending.data.map((w) => (
          <Pressable
            key={w.id}
            accessibilityRole="button"
            accessibilityLabel={`Review ${w.repoFull}`}
            onPress={() => router.push(`/(tabs)/review/${w.id}`)}
            className="gap-2 rounded-lg border-hairline border-hairline bg-surface p-4 active:bg-elevated"
          >
            <View className="flex-row items-center gap-2">
              <Text variant="label" className="flex-1">
                {w.repoFull}
              </Text>
              {w.status === 'needs_rebase' ? <Badge label="Remote moved" tone="warning" /> : null}
              {w.status === 'syncing' ? <Badge label="Syncing" tone="accent" /> : null}
            </View>
            <View className="flex-row items-center justify-between">
              <Text variant="caption" tone="muted">
                {w.provider} · {relativeTime(w.createdAt)}
              </Text>
              <Countdown expiresAt={w.expiresAt} />
            </View>
          </Pressable>
        ))
      ) : (
        <EmptyState
          title="Nothing to review"
          body="When an agent finishes, its changes appear here for review before anything is pushed."
        />
      )}

      {log.data?.length ? (
        <View className="gap-1 pt-4">
          <Text variant="caption" tone="muted" className="uppercase tracking-widest">
            Recently erased
          </Text>
          {log.data.map((l) => (
            <View key={l.id} className="flex-row items-center gap-2 border-b-hairline border-hairline py-2.5">
              <Text variant="label" className="flex-1" numberOfLines={1}>
                {l.repo_full}
                {l.branch ? ` → ${l.branch}` : ''}
              </Text>
              <Badge label={l.outcome} tone={l.outcome === 'pushed' ? 'success' : 'muted'} />
              <Text variant="monoSmall" tone="muted">
                {l.commit_sha?.slice(0, 7) ?? ''}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

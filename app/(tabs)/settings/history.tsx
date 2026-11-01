import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react-native';
import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { useReadyServices } from '@/hooks/useServices';
import { Badge, EmptyState, Screen, Text } from '@/ui/primitives';
import { relativeTime, TaskRow } from '@/ui/TaskList';
import { useTheme } from '@/ui/ThemeProvider';

export default function HistoryScreen() {
  const s = useReadyServices();
  const t = useTheme();
  const [q, setQ] = useState('');
  const tasks = useQuery({ queryKey: ['history', q], queryFn: () => s.tasks.search(q) });
  const pushes = useQuery({ queryKey: ['push-log-all'], queryFn: () => s.workspaces.pushLog(200) });
  return (
    <Screen title="History">
      <View className="min-h-[44px] flex-row items-center gap-2 rounded-md border-hairline border-hairline bg-surface px-3">
        <Search size={16} color={t.colors.muted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search tasks or repos"
          placeholderTextColor={t.colors.muted}
          accessibilityLabel="Search history"
          className="flex-1 font-sans text-[15px] text-fg"
        />
      </View>
      {tasks.data?.length ? (
        tasks.data.map((task) => <TaskRow key={task.id} task={task} />)
      ) : (
        <EmptyState title="No matches" body="Try a different search." />
      )}

      <Text variant="caption" tone="muted" className="pt-4 uppercase tracking-widest">
        What was pushed where (metadata only)
      </Text>
      {(pushes.data ?? []).map((l) => (
        <View key={l.id} className="gap-0.5 border-b-hairline border-hairline py-2.5">
          <View className="flex-row items-center gap-2">
            <Text variant="label" className="flex-1" numberOfLines={1}>
              {l.repo_full}
              {l.branch ? ` → ${l.branch}` : ''}
            </Text>
            <Badge label={l.outcome} tone={l.outcome === 'pushed' ? 'success' : 'muted'} />
          </View>
          <Text variant="caption" tone="muted">
            {l.commit_sha ? `${l.commit_sha.slice(0, 7)} · ` : ''}
            {l.files_count} files · {relativeTime(l.at)}
          </Text>
        </View>
      ))}
    </Screen>
  );
}

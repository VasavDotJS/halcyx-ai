import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import type { TaskRecord } from '@/core/agent/taskStore';
import type { TaskStatus } from '@/core/types';
import { Badge, Text } from './primitives';

const STATUS: Record<TaskStatus, { label: string; tone: 'muted' | 'accent' | 'success' | 'warning' | 'danger' }> = {
  queued: { label: 'Queued', tone: 'muted' },
  running: { label: 'Running', tone: 'accent' },
  paused: { label: 'Paused', tone: 'muted' },
  awaiting_approval: { label: 'Needs approval', tone: 'warning' },
  completed: { label: 'Ready', tone: 'success' },
  incomplete: { label: 'Stopped at budget', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Stopped', tone: 'muted' },
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  const s = STATUS[status];
  return <Badge label={s.label} tone={s.tone} />;
}

export function relativeTime(at: number): string {
  const d = Date.now() - at;
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return new Date(at).toLocaleDateString();
}

export function TaskRow({ task }: { task: TaskRecord }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${task.title}. ${task.repoFull}. ${STATUS[task.status].label}`}
      onPress={() => router.push(`/(tabs)/chat/${task.id}`)}
      className="min-h-[64px] gap-1 border-b-hairline border-hairline py-3 active:bg-surface"
    >
      <View className="flex-row items-center gap-2">
        <Text variant="label" numberOfLines={1} className="flex-1">
          {task.title}
        </Text>
        <StatusBadge status={task.status} />
      </View>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {task.repoFull} · {task.model} · {relativeTime(task.createdAt)}
        {task.costUsd > 0 ? ` · $${task.costUsd.toFixed(2)}` : ''}
      </Text>
    </Pressable>
  );
}

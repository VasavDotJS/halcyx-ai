import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Trophy } from 'lucide-react-native';
import { View } from 'react-native';
import { TERMINAL } from '@/core/agent/timeline';
import { useReadyServices } from '@/hooks/useServices';
import { Badge, Button, Card, Row, Screen, Text } from '@/ui/primitives';
import { StatusBadge } from '@/ui/TaskList';

/** Side-by-side results of a multi-agent run; keep the winner, discard the rest. */
export default function Compare() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const s = useReadyServices();
  const group = useQuery({
    queryKey: ['group', groupId],
    refetchInterval: 5_000,
    queryFn: async () => {
      const tasks = await s.tasks.byGroup(groupId);
      return Promise.all(
        tasks.map(async (task) => {
          let files = 0;
          let checks = '—';
          if (task.workspaceId) {
            try {
              const ws = await s.workspaces.get(task.workspaceId);
              files = (await s.workspaces.files(task.workspaceId)).length;
              checks = `lint ${ws.meta.checks.lint.status} · tests ${ws.meta.checks.tests.status}`;
            } catch {
              checks = 'erased';
            }
          }
          return { task, files, checks };
        }),
      );
    },
  });
  const all = group.data ?? [];
  const done = all.every((g) => TERMINAL.includes(g.task.status));

  return (
    <Screen title="Compare agents">
      <Text tone="muted">Each agent works on its own branch. {done ? 'All finished — pick the one to keep.' : 'Results update live.'}</Text>
      <View className="gap-3 md:flex-row">
        {all.map(({ task, files, checks }) => (
          <Card key={task.id} className="flex-1 gap-2">
            <Row>
              <Text variant="label" className="flex-1">
                {task.model}
              </Text>
              <StatusBadge status={task.status} />
            </Row>
            <Badge label={task.effort} />
            <Text variant="caption" tone="muted">
              {files} files · {checks}
            </Text>
            <Text variant="caption" tone="muted">
              {(task.inputTokens + task.outputTokens).toLocaleString()} tokens · ${task.costUsd.toFixed(3)} ·{' '}
              {Math.round((task.updatedAt - task.createdAt) / 1000)}s
            </Text>
            <Button title="Open" size="sm" variant="secondary" onPress={() => router.push(`/(tabs)/chat/${task.id}`)} />
            {task.workspaceId && task.status === 'completed' ? (
              <Button
                title="Keep this one"
                size="sm"
                icon={Trophy}
                onPress={async () => {
                  for (const other of all) {
                    if (other.task.id !== task.id && other.task.workspaceId)
                      await s.runner.discard(other.task.workspaceId).catch(() => undefined);
                  }
                  router.replace(`/(tabs)/review/${task.workspaceId}`);
                }}
              />
            ) : null}
          </Card>
        ))}
      </View>
    </Screen>
  );
}

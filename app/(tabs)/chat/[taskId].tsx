import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Eye, GitCompareArrows, Pause, Play, ShieldQuestion, Square } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TERMINAL } from '@/core/agent/timeline';
import { useReadyServices } from '@/hooks/useServices';
import { useTaskStream } from '@/hooks/useTaskStream';
import { useSettings } from '@/state/settings';
import { Composer } from '@/ui/Composer';
import { haptic } from '@/ui/haptics';
import { Button, IconButton, Row, Text } from '@/ui/primitives';
import { ReviewPanel } from '@/ui/ReviewPanel';
import { StatusBadge } from '@/ui/TaskList';
import { Timeline } from '@/ui/Timeline';

export default function TaskScreen() {
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  const s = useReadyServices();
  const { width } = useWindowDimensions();
  const { timeline, task, refresh } = useTaskStream(taskId);
  const askBefore = useSettings((x) => x.askBeforeCommands);
  const update = useSettings((x) => x.update);
  const [error, setError] = useState<string | null>(null);
  const wide = width >= 900;
  const status = task?.status ?? timeline.status;
  const running = status === 'running' || status === 'queued';
  const finished = TERMINAL.includes(status);

  const act = (fn: () => Promise<void>) => async () => {
    setError(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const chat = (
    <View className="flex-1">
      <ScrollView contentContainerClassName="gap-4 p-4 pb-8" keyboardShouldPersistTaps="handled">
        {task ? (
          <View className="gap-1">
            <Text variant="heading">{task.title}</Text>
            <Row className="flex-wrap">
              <StatusBadge status={status} />
              <Text variant="caption" tone="muted">
                {task.repoFull} · {task.model} · {task.effort} · {(timeline.inputTokens + timeline.outputTokens).toLocaleString()} tokens
                {task.costUsd > 0 ? ` · $${task.costUsd.toFixed(3)}` : ''}
              </Text>
            </Row>
          </View>
        ) : null}
        <Timeline
          data={timeline}
          onApprove={(id, allow) => {
            haptic.impact();
            void act(() => s.runner.respond(taskId, id, allow))();
          }}
        />
        {error ? <Text tone="danger">{error}</Text> : null}
        {task?.workspaceId && !wide ? (
          <Button title="Review changes" icon={GitCompareArrows} onPress={() => router.push(`/(tabs)/review/${task.workspaceId}`)} />
        ) : null}
        {timeline.previewUrl ? (
          <Button
            title="Open live preview"
            variant="secondary"
            icon={Eye}
            onPress={() => router.push({ pathname: '/preview', params: { url: timeline.previewUrl! } })}
          />
        ) : null}
      </ScrollView>
      <View className="gap-2 border-t-hairline border-hairline px-4 pb-2 pt-3">
        <Composer
          placeholder={finished ? 'Ask for changes or a follow-up…' : 'Add guidance (sent after this step)…'}
          allowImages={false}
          disabled={status === 'awaiting_approval'}
          onSubmit={({ text }) => void act(() => s.runner.followUp(taskId, text))()}
        />
      </View>
    </View>
  );

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-bg">
      <Stack.Screen
        options={{
          title: 'Task',
          headerRight: () => (
            <Row>
              <IconButton
                icon={ShieldQuestion}
                label={askBefore ? 'Ask before running commands: on' : 'Ask before running commands: off'}
                active={askBefore}
                tone={askBefore ? 'accent' : 'muted'}
                onPress={() => update({ askBeforeCommands: !askBefore })}
              />
              {running ? <IconButton icon={Pause} label="Pause" onPress={act(() => s.runner.pause(taskId))} /> : null}
              {status === 'paused' || status === 'incomplete' ? (
                <IconButton icon={Play} label="Resume" onPress={act(() => s.runner.resume(taskId))} />
              ) : null}
              {!finished ? <IconButton icon={Square} label="Stop" tone="danger" onPress={act(() => s.runner.stop(taskId))} /> : null}
            </Row>
          ),
        }}
      />
      {wide && task?.workspaceId ? (
        <View className="flex-1 flex-row">
          <View className="w-[44%] border-r-hairline border-hairline">{chat}</View>
          <ScrollView className="flex-1" contentContainerClassName="p-4">
            <ReviewPanel workspaceId={task.workspaceId} />
          </ScrollView>
        </View>
      ) : (
        <View className="mx-auto w-full max-w-[880px] flex-1">{chat}</View>
      )}
    </SafeAreaView>
  );
}

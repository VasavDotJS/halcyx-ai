import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { listNotifications, markAllRead } from '@/core/notifications/notify';
import { useReadyServices } from '@/hooks/useServices';
import { useSettings } from '@/state/settings';
import { Button, EmptyState, Screen, Section, Segmented, Text, Toggle } from '@/ui/primitives';
import { relativeTime } from '@/ui/TaskList';

export default function Notifications() {
  const s = useReadyServices();
  const settings = useSettings();
  const list = useQuery({ queryKey: ['notifications'], queryFn: () => listNotifications(s.platform.db) });
  return (
    <Screen title="Notifications">
      <Section title="Alerts">
        <Toggle
          label="When a task finishes"
          value={settings.notifyOnFinish}
          onChange={(v) => settings.update({ notifyOnFinish: v })}
          last
        />
      </Section>
      <Text variant="label">Email digest</Text>
      <Segmented
        label="Email digest"
        value={settings.emailDigest}
        onChange={(v) => settings.update({ emailDigest: v })}
        options={[
          { value: 'off', label: 'Off' },
          { value: 'daily', label: 'Daily' },
          { value: 'weekly', label: 'Weekly' },
        ]}
      />
      <Text variant="caption" tone="muted">
        Digests list task metadata only (repo, status, tokens) — never prompts or code.
      </Text>

      <View className="flex-row items-center justify-between pt-2">
        <Text variant="caption" tone="muted" className="uppercase tracking-widest">
          Notification center
        </Text>
        <Button
          title="Mark all read"
          size="sm"
          variant="ghost"
          onPress={async () => {
            await markAllRead(s.platform.db);
            void list.refetch();
          }}
        />
      </View>
      {list.data?.length ? (
        list.data.map((n) => (
          <Pressable
            key={n.id}
            accessibilityRole="button"
            accessibilityLabel={`${n.read ? '' : 'Unread. '}${n.title}. ${n.body}`}
            disabled={!n.task_id}
            onPress={() => n.task_id && router.push(`/(tabs)/chat/${n.task_id}`)}
            className="gap-0.5 border-b-hairline border-hairline py-3 active:bg-surface"
          >
            <View className="flex-row items-center gap-2">
              {!n.read ? <View className="h-2 w-2 rounded-full bg-accent" /> : null}
              <Text variant="label" className="flex-1">
                {n.title}
              </Text>
              <Text variant="caption" tone="muted">
                {relativeTime(n.created_at)}
              </Text>
            </View>
            <Text tone="muted">{n.body}</Text>
          </Pressable>
        ))
      ) : (
        <EmptyState title="All caught up" body="Task updates and expiry reminders show up here." />
      )}
    </Screen>
  );
}

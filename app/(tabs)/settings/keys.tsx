import { router } from 'expo-router';
import { PROVIDERS } from '@/core/providers/registry';
import { useKeys } from '@/hooks/useKeys';
import { useReadyServices } from '@/hooks/useServices';
import { Badge, ListRow, Screen, Section, Text } from '@/ui/primitives';
import { relativeTime } from '@/ui/TaskList';

const TONE = { valid: 'success', invalid: 'danger', quota_exceeded: 'warning', network_error: 'muted', unknown: 'muted' } as const;
const LABEL = {
  valid: 'Valid',
  invalid: 'Invalid',
  quota_exceeded: 'Quota exceeded',
  network_error: 'Offline',
  unknown: 'Unchecked',
} as const;

export default function Keys() {
  const s = useReadyServices();
  const { keys } = useKeys();
  return (
    <Screen title="API keys">
      <Text tone="muted">
        Keys are stored only in this device’s {s.platform.secrets.hardwareBacked ? 'secure keystore' : 'encrypted browser storage'} and are
        sent only to the provider they belong to. They never reach HALCYX servers.
      </Text>
      {!s.platform.secrets.hardwareBacked ? (
        <Text tone="warning">Web storage is less secure than a phone’s keystore. Prefer the iOS or Android app for long-lived keys.</Text>
      ) : null}
      <Section>
        {keys.map((k, i) => (
          <ListRow
            key={k.provider}
            label={PROVIDERS[k.provider].label}
            detail={k.saved ? (k.status ? `Checked ${relativeTime(k.status.checkedAt)}` : 'Saved') : 'Not set'}
            last={i === keys.length - 1}
            right={
              k.saved ? (
                <Badge label={LABEL[k.status?.status ?? 'unknown']} tone={TONE[k.status?.status ?? 'unknown']} />
              ) : (
                <Badge label="Add" tone="accent" />
              )
            }
            onPress={() => router.push(`/keys/${k.provider}`)}
          />
        ))}
      </Section>
    </Screen>
  );
}

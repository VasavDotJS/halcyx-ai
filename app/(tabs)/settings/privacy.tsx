import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Share } from 'react-native';
import { Download, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { wipeAllLocalData } from '@/core/app/services';
import { formatBytes } from '@/core/cleaner/patterns';
import { authenticate } from '@/core/security/biometrics';
import { useReadyServices } from '@/hooks/useServices';
import { exportSettings, useSettings } from '@/state/settings';
import { Button, Card, ListRow, Screen, Section, Text } from '@/ui/primitives';

const WHERE: { what: string; where: string }[] = [
  { what: 'Provider API keys', where: 'This device only (Keychain / Keystore). Sent only to that provider.' },
  { what: 'GitHub token', where: 'This device only. The agent gets a separate read-only, single-repo token.' },
  { what: 'Agent output (code)', where: 'Encrypted on this device until pushed or expired, then crypto-shredded.' },
  { what: 'Remote sandbox', where: 'At your provider while the task runs; deleted after push unless you keep it.' },
  { what: 'Prompts & task history', where: 'Encrypted on this device. Only metadata (repo, status, tokens) goes to HALCYX.' },
  { what: 'Account & preferences', where: 'HALCYX backend (Supabase): email, theme, defaults, device list.' },
  { what: 'Crash reports', where: 'Sentry, scrubbed of keys, tokens and anything that looks like code.' },
];

export default function Privacy() {
  const s = useReadyServices();
  const reset = useSettings((x) => x.reset);
  const [busy, setBusy] = useState(false);
  const stats = useQuery({
    queryKey: ['privacy-stats'],
    queryFn: async () => {
      const pending = await s.workspaces.listPending();
      let bytes = 0;
      for (const w of pending) bytes += await s.workspaces.cacheBytes(w.id);
      const tasks = (await s.platform.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM tasks'))?.n ?? 0;
      return { pending: pending.length, bytes, tasks };
    },
  });

  return (
    <Screen title="Privacy">
      <Card className="gap-1">
        <Text variant="label">On this device now</Text>
        <Text tone="muted">
          {stats.data?.pending ?? 0} pending workspaces · {formatBytes(stats.data?.bytes ?? 0)} encrypted cache · {stats.data?.tasks ?? 0}{' '}
          tasks in history · keys stored {s.platform.secrets.hardwareBacked ? 'in the secure keystore' : 'in encrypted browser storage'}
        </Text>
      </Card>
      <Section title="What’s stored where">
        {WHERE.map((w, i) => (
          <ListRow key={w.what} label={w.what} detail={w.where} last={i === WHERE.length - 1} />
        ))}
      </Section>
      <Button
        title="Export settings"
        variant="secondary"
        icon={Download}
        onPress={() => void Share.share({ title: 'HALCYX settings', message: exportSettings() })}
      />
      <Button
        title="Wipe all local data"
        variant="danger"
        icon={Trash2}
        loading={busy}
        onPress={async () => {
          if (!(await authenticate('Wipe all HALCYX data on this device'))) return;
          setBusy(true);
          await wipeAllLocalData();
          reset();
          setBusy(false);
          router.replace('/(auth)/sign-in');
        }}
      />
      <Text variant="caption" tone="muted">
        Wiping shreds every pending workspace, deletes keys, tokens, history and caches, then signs you out. Your account and GitHub
        repositories are not affected.
      </Text>
    </Screen>
  );
}

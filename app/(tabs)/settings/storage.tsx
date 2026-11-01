import { useQuery } from '@tanstack/react-query';
import { HardDrive, Sparkles } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import { formatBytes } from '@/core/cleaner/patterns';
import { useReadyServices } from '@/hooks/useServices';
import { useSettings } from '@/state/settings';
import { Badge, Button, Card, EmptyState, Row, Screen, Section, Segmented, Text, Toggle } from '@/ui/primitives';
import { relativeTime } from '@/ui/TaskList';

export default function Storage() {
  const s = useReadyServices();
  const settings = useSettings();
  const [busy, setBusy] = useState<string | null>(null);
  const [freed, setFreed] = useState<number | null>(null);
  const scan = useQuery({ queryKey: ['cleaner-scan'], queryFn: () => s.cleaner.scan() });
  const total = (scan.data ?? []).reduce((a, p) => a + p.reclaimable, 0);

  return (
    <Screen title="Storage cleaner">
      <Card className="gap-1">
        <Text variant="caption" tone="muted" className="uppercase tracking-widest">
          Reclaimable
        </Text>
        <Text variant="display">{formatBytes(total)}</Text>
        <Text variant="caption" tone="muted">
          Dependencies, build output and caches only. Source files and unpushed work are never touched — remote cleanup uses `git clean -X`,
          which removes only git-ignored files. Dependencies reinstall from lockfiles on demand.
        </Text>
        {freed !== null ? <Text tone="success">Freed {formatBytes(freed)}.</Text> : null}
      </Card>
      <Button
        title="Clean all"
        icon={Sparkles}
        disabled={!total}
        loading={busy === 'all'}
        onPress={async () => {
          setBusy('all');
          setFreed(await s.cleaner.cleanAll(scan.data ?? []));
          setBusy(null);
          void scan.refetch();
        }}
      />

      {scan.isLoading ? (
        <Text tone="muted">Scanning local cache and remote sandboxes…</Text>
      ) : scan.data?.length ? (
        scan.data.map((p) => (
          <Card key={p.key} className="gap-2">
            <Row>
              <HardDrive size={16} />
              <Text variant="label" className="flex-1">
                {p.repoFull}
              </Text>
              <Badge label={p.where === 'local' ? 'on device' : `${p.provider} sandbox`} />
            </Row>
            <Text variant="caption" tone="muted">
              {formatBytes(p.reclaimable)} reclaimable · last used {relativeTime(p.lastUsedAt)}
            </Text>
            {p.groups.slice(0, 5).map((g) => (
              <Text key={g.root} variant="monoSmall" tone="muted">
                {g.root} · {formatBytes(g.bytes)}
              </Text>
            ))}
            <View className="flex-row">
              <Button
                title="Clean"
                size="sm"
                variant="secondary"
                disabled={!p.reclaimable}
                loading={busy === p.key}
                onPress={async () => {
                  setBusy(p.key);
                  await s.cleaner.clean(p);
                  setFreed(p.reclaimable);
                  setBusy(null);
                  void scan.refetch();
                }}
              />
            </View>
          </Card>
        ))
      ) : (
        <EmptyState title="All clean" body="No cached dependencies in pending workspaces or remote sandboxes." />
      )}

      <Section title="Auto-clean">
        <Toggle
          label="Auto-clean"
          detail="Runs in the background"
          value={settings.autoClean}
          onChange={(v) => settings.update({ autoClean: v })}
          last
        />
      </Section>
      {settings.autoClean ? (
        <Segmented
          label="Clean projects untouched for"
          value={String(settings.autoCleanDays)}
          onChange={(v) => settings.update({ autoCleanDays: Number(v) })}
          options={[
            { value: '3', label: '3 days' },
            { value: '7', label: '7 days' },
            { value: '14', label: '14 days' },
            { value: '30', label: '30 days' },
          ]}
        />
      ) : null}
    </Screen>
  );
}

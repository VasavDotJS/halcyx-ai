import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { useReadyServices } from '@/hooks/useServices';
import { Badge, Button, ListRow, Screen, Section, Text } from '@/ui/primitives';
import { relativeTime } from '@/ui/TaskList';

export default function Devices() {
  const s = useReadyServices();
  const thisDevice = useQuery({ queryKey: ['device-id'], queryFn: () => AsyncStorage.getItem('halcyx.device-id') });
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => s.backend.listDevices() });
  return (
    <Screen title="Devices & sessions">
      <Text tone="muted">Revoking a device signs it out immediately. Its local keys and workspaces stay encrypted on that device.</Text>
      <Section>
        {(devices.data ?? []).map((d, i, all) => {
          const current = d.device_id === thisDevice.data;
          return (
            <ListRow
              key={d.id}
              label={`${d.name}${current ? ' (this device)' : ''}`}
              detail={`${d.platform} · v${d.app_version} · active ${relativeTime(new Date(d.last_seen_at).getTime())}`}
              last={i === all.length - 1}
              right={
                d.revoked ? (
                  <Badge label="Revoked" />
                ) : current ? undefined : (
                  <Button
                    title="Revoke"
                    size="sm"
                    variant="danger"
                    onPress={async () => {
                      await s.backend.revokeDevice(d.id);
                      void devices.refetch();
                    }}
                  />
                )
              }
            />
          );
        })}
      </Section>
      <Button
        title="Sign out everywhere else"
        variant="secondary"
        onPress={async () => {
          await s.supabase.auth.signOut({ scope: 'others' });
          void devices.refetch();
        }}
      />
    </Screen>
  );
}

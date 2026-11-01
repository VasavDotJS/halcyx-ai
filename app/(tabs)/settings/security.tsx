import { useQuery } from '@tanstack/react-query';
import { biometricSupport, authenticate } from '@/core/security/biometrics';
import { useSettings } from '@/state/settings';
import { Screen, Section, Segmented, Text, Toggle } from '@/ui/primitives';

export default function Security() {
  const s = useSettings();
  const bio = useQuery({ queryKey: ['biometrics'], queryFn: biometricSupport });
  return (
    <Screen title="Security">
      <Section title="App lock" footer={bio.data?.available ? undefined : 'No biometrics enrolled — your device passcode will be used.'}>
        <Toggle
          label={`Require ${bio.data?.label ?? 'biometrics'} to open`}
          value={s.appLock}
          onChange={async (v) => {
            if (v && !(await authenticate('Enable app lock'))) return;
            s.update({ appLock: v });
          }}
          last
        />
      </Section>
      {s.appLock ? (
        <>
          <Text variant="label">Auto-lock after</Text>
          <Segmented
            label="Auto-lock after"
            value={String(s.autoLockMinutes)}
            onChange={(v) => s.update({ autoLockMinutes: Number(v) })}
            options={[
              { value: '0', label: 'Immediately' },
              { value: '1', label: '1 min' },
              { value: '5', label: '5 min' },
              { value: '15', label: '15 min' },
            ]}
          />
        </>
      ) : null}
      <Text variant="caption" tone="muted">
        Revealing a saved API key or overriding a blocked push always requires authentication, even with app lock off.
      </Text>
    </Screen>
  );
}

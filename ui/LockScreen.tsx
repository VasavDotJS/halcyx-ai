import { Lock } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { authenticate, biometricSupport } from '@/core/security/biometrics';
import { useSession } from '@/state/session';
import { Logo } from './Logo';
import { Button } from './primitives/Button';
import { Text } from './primitives/Text';
import { useTheme } from './ThemeProvider';

/** Full-screen biometric lock shown on launch and after the auto-lock timeout. */
export function LockScreen() {
  const t = useTheme();
  const unlock = useSession((s) => s.unlock);
  const [label, setLabel] = useState('Unlock');
  const [failed, setFailed] = useState(false);

  const attempt = async () => {
    setFailed(false);
    if (await authenticate('Unlock HALCYX')) unlock();
    else setFailed(true);
  };

  useEffect(() => {
    let alive = true;
    void biometricSupport().then((b) => alive && setLabel(`Unlock with ${b.label}`));
    void authenticate('Unlock HALCYX').then((ok) => {
      if (!alive) return;
      if (ok) unlock();
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [unlock]);

  return (
    <View accessibilityViewIsModal className="absolute inset-0 items-center justify-center gap-6 bg-bg px-8">
      <Logo height={26} />
      <Lock size={28} color={t.colors.muted} />
      <Text tone="muted" className="text-center">
        HALCYX is locked.
      </Text>
      <Button title={label} onPress={attempt} />
      {failed ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          Authentication failed. Try again.
        </Text>
      ) : null}
    </View>
  );
}

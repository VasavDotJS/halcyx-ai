import type { ReactNode } from 'react';
import { Platform, View, type GestureResponderEvent } from 'react-native';
import { useTheme } from '@/ui/ThemeProvider';
import { useWavePointer } from './pointer';
import { WaveBackground } from './WaveBackground';

/** Pitch-black stage with the rippling silk shader behind the sign-in / sign-up screens. */
export function AuthBackdrop({ children }: { children: ReactNode }) {
  const t = useTheme();
  const pointer = useWavePointer();
  // Native: touches anywhere send a ripple through the silk (web listens to pointer events itself).
  const onTouch =
    Platform.OS === 'web'
      ? undefined
      : (e: GestureResponderEvent) => {
          pointer.x.set(e.nativeEvent.pageX);
          pointer.y.set(e.nativeEvent.pageY);
          pointer.amt.set(Math.min(1, pointer.amt.get() + 0.35));
        };
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }} onTouchStart={onTouch} onTouchMove={onTouch}>
      <WaveBackground reduceMotion={t.reduceMotion} pointer={pointer} />
      {children}
    </View>
  );
}

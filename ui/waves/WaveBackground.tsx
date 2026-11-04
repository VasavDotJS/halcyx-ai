import { Canvas, Fill, Shader, Skia } from '@shopify/react-native-skia';
import { useEffect } from 'react';
import { PixelRatio, StyleSheet, useWindowDimensions } from 'react-native';
import { useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { useWavePointer, type WavePointer } from './pointer';
import { RIPPLE_DECAY, STILL_TIME, WAVES_SKSL } from './shader';

const effect = Skia.RuntimeEffect.Make(WAVES_SKSL);

/**
 * Animated "dark silk" backdrop (Skia runtime shader on the GPU). Time and the touch ripple are
 * advanced on the UI thread; reduced motion shows one still frame.
 */
export function WaveBackground({ reduceMotion = false, pointer }: { reduceMotion?: boolean; pointer?: WavePointer }) {
  const { width, height } = useWindowDimensions();
  const time = useSharedValue(STILL_TIME);
  const fallback = useWavePointer();
  const p = pointer ?? fallback;
  const grain = PixelRatio.get();

  const clock = useFrameCallback((info) => {
    'worklet';
    const dt = Math.min(0.1, (info.timeSincePreviousFrame ?? 16) / 1000);
    time.set(time.get() + dt);
    p.amt.set(p.amt.get() * Math.exp(-dt * RIPPLE_DECAY));
  }, false);

  useEffect(() => {
    clock.setActive(!reduceMotion);
    if (reduceMotion) time.set(STILL_TIME);
    return () => clock.setActive(false);
  }, [reduceMotion, clock, time]);

  const uniforms = useDerivedValue(() => ({
    uRes: [width, height],
    uTime: time.get(),
    uPointer: [p.x.get(), p.y.get()],
    uPointerAmt: p.amt.get(),
    uGrain: grain,
  }));

  if (!effect) return null;
  return (
    <Canvas
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Fill>
        <Shader source={effect} uniforms={uniforms} />
      </Fill>
    </Canvas>
  );
}

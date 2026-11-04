import { type SharedValue, useSharedValue } from 'react-native-reanimated';

export type WavePointer = { x: SharedValue<number>; y: SharedValue<number>; amt: SharedValue<number> };

/** Shared touch state: the backdrop writes touches, the shader reads them on the UI thread. */
export function useWavePointer(): WavePointer {
  return { x: useSharedValue(0), y: useSharedValue(0), amt: useSharedValue(0) };
}

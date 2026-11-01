import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { useSettings } from '@/state/settings';

/** Haptics on key actions (send, approve, push), respecting the user's setting. */
export const haptic = {
  tap() {
    if (Platform.OS !== 'web' && useSettings.getState().haptics) void Haptics.selectionAsync();
  },
  success() {
    if (Platform.OS !== 'web' && useSettings.getState().haptics) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  },
  warning() {
    if (Platform.OS !== 'web' && useSettings.getState().haptics) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  },
  impact() {
    if (Platform.OS !== 'web' && useSettings.getState().haptics) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  },
};

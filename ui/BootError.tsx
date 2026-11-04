import { Platform, View } from 'react-native';
import { reclaimFromOtherTab } from '@/state/tab';
import { Logo } from './Logo';
import { Button } from './primitives/Button';
import { Text } from './primitives/Text';

/** Web storage needs a cross-origin isolated page (SharedArrayBuffer for SQLite). */
const notIsolated = () => Platform.OS === 'web' && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === false;

/** Shown when local storage or configuration can't be initialised (instead of a blank screen). */
export function BootError({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const isolation = notIsolated();
  return (
    <View className="flex-1 items-center justify-center gap-4 bg-bg px-8">
      <Logo height={24} />
      <Text variant="heading" className="text-center" accessibilityRole="header">
        HALCYX couldn’t start
      </Text>
      <Text tone="muted" className="max-w-[480px] text-center" selectable>
        {isolation
          ? 'This browser blocked the encrypted on-device storage HALCYX needs. Reload once; if it still fails, use a current Chrome, Edge, Firefox or Safari, or the iOS / Android app.'
          : error.message}
      </Text>
      {onRetry ? (
        <Button
          title={isolation ? 'Reload' : 'Try again'}
          variant="secondary"
          onPress={isolation ? () => globalThis.location.reload() : onRetry}
        />
      ) : null}
    </View>
  );
}

/** Web: another tab took over the local database (only one tab can hold it). */
export function OpenElsewhere() {
  return (
    <View className="flex-1 items-center justify-center gap-4 bg-bg px-8">
      <Logo height={24} />
      <Text variant="heading" className="text-center" accessibilityRole="header">
        HALCYX is open in another tab
      </Text>
      <Text tone="muted" className="max-w-[480px] text-center">
        Your encrypted data can only be used in one tab at a time, so this tab has stepped aside.
      </Text>
      <Button title="Use HALCYX here" variant="secondary" onPress={reclaimFromOtherTab} />
    </View>
  );
}

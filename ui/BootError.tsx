import { Platform, View } from 'react-native';
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

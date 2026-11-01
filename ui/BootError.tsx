import { View } from 'react-native';
import { Logo } from './Logo';
import { Text } from './primitives/Text';

/** Shown when local storage or configuration can't be initialised (instead of a blank screen). */
export function BootError({ error }: { error: Error }) {
  return (
    <View className="flex-1 items-center justify-center gap-4 bg-bg px-8">
      <Logo height={24} />
      <Text variant="heading" className="text-center">
        HALCYX couldn’t start
      </Text>
      <Text tone="muted" className="text-center" selectable>
        {error.message}
      </Text>
    </View>
  );
}

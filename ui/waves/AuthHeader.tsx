import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { View } from 'react-native';
import { IconButton } from '@/ui/primitives';

/** Minimal back control for auth screens drawn over the wave backdrop (no opaque native header). */
export function AuthHeader() {
  return (
    <View className="-ml-2 flex-row">
      <IconButton
        icon={ChevronLeft}
        label="Back"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/(auth)/sign-in'))}
      />
    </View>
  );
}

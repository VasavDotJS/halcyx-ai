import { X } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../ThemeProvider';
import { IconButton } from './IconButton';
import { Text } from './Text';

/** Bottom sheet built on RN Modal (native slide, accessible, respects reduced motion). */
export function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useTheme();
  return (
    <Modal
      visible={visible}
      transparent
      animationType={t.reduceMotion ? 'none' : 'slide'}
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <Pressable accessibilityLabel="Close" className="flex-1 bg-black/50" onPress={onClose} />
      <SafeAreaView edges={['bottom']} className="max-h-[85%] rounded-t-lg border-hairline border-hairline bg-elevated">
        <View className="mx-auto w-full max-w-[640px]">
          <View className="flex-row items-center justify-between px-4 pt-3">
            <Text variant="heading" accessibilityRole="header">
              {title}
            </Text>
            <IconButton icon={X} label="Close" onPress={onClose} />
          </View>
          <ScrollView contentContainerClassName="gap-3 px-4 pb-6 pt-2" keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

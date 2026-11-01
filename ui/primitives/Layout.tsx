import { Stack } from 'expo-router';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View, type ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from './Text';

/** Screen shell: safe areas, optional scroll, readable max width on tablets and desktop. */
export function Screen({
  title,
  children,
  scroll = true,
  headerRight,
  edges = ['bottom'],
  padded = true,
  narrow = false,
}: {
  title?: string;
  children: ReactNode;
  scroll?: boolean;
  headerRight?: () => ReactNode;
  edges?: ('top' | 'bottom')[];
  padded?: boolean;
  /** Forms (auth, onboarding): a narrower column reads better on tablets and desktop. */
  narrow?: boolean;
}) {
  const body = (
    <View className={`mx-auto w-full ${narrow ? 'max-w-[480px]' : 'max-w-[880px]'} ${padded ? 'px-4 py-4' : ''} gap-4`}>{children}</View>
  );
  return (
    <SafeAreaView edges={edges} className="flex-1 bg-bg">
      {title !== undefined ? <Stack.Screen options={{ title, headerRight }} /> : null}
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {scroll ? (
          <ScrollView keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic">
            {body}
          </ScrollView>
        ) : (
          body
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Card({ className = '', ...rest }: ViewProps & { className?: string }) {
  return <View className={`rounded-lg border-hairline border-hairline bg-surface p-4 ${className}`} {...rest} />;
}

export function Section({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  return (
    <View className="gap-2">
      {title ? (
        <Text variant="caption" tone="muted" className="px-1 uppercase tracking-widest" accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      <View className="overflow-hidden rounded-lg border-hairline border-hairline bg-surface">{children}</View>
      {footer ? (
        <Text variant="caption" tone="muted" className="px-1">
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

export function Divider() {
  return <View className="h-px bg-hairline" />;
}

export function Row({ className = '', ...rest }: ViewProps & { className?: string }) {
  return <View className={`flex-row items-center gap-2 ${className}`} {...rest} />;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <View className="items-center gap-2 rounded-lg border-hairline border-dashed border-hairline px-6 py-10">
      <Text variant="heading">{title}</Text>
      <Text tone="muted" className="text-center">
        {body}
      </Text>
      {action ? <View className="mt-2">{action}</View> : null}
    </View>
  );
}

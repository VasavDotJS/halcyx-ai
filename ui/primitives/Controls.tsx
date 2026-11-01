import { ChevronRight, type LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, Switch, TextInput, type TextInputProps, View } from 'react-native';
import { haptic } from '../haptics';
import { useTheme } from '../ThemeProvider';
import { Divider } from './Layout';
import { Text } from './Text';

export function Input({
  label,
  error,
  hint,
  mono,
  className = '',
  ...rest
}: TextInputProps & { label?: string; error?: string | null; hint?: string; mono?: boolean }) {
  const t = useTheme();
  return (
    <View className="gap-1.5">
      {label ? <Text variant="label">{label}</Text> : null}
      <TextInput
        placeholderTextColor={t.colors.muted}
        selectionColor={t.colors.accent}
        accessibilityLabel={label ?? rest.placeholder}
        className={`min-h-[46px] rounded-md border-hairline bg-surface px-3 py-2.5 text-[15px] text-fg ${
          error ? 'border-danger' : 'border-hairline'
        } ${mono ? 'font-mono' : 'font-sans'} ${className}`}
        {...rest}
      />
      {error ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export function ListRow({
  label,
  detail,
  icon: Icon,
  right,
  onPress,
  last,
  tone = 'fg',
}: {
  label: string;
  detail?: string;
  icon?: LucideIcon;
  right?: ReactNode;
  onPress?: () => void;
  last?: boolean;
  tone?: 'fg' | 'danger';
}) {
  const t = useTheme();
  const content = (
    <View className="min-h-[52px] flex-row items-center gap-3 px-4 py-3">
      {Icon ? <Icon size={18} color={tone === 'danger' ? t.colors.danger : t.colors.muted} strokeWidth={1.75} /> : null}
      <View className="flex-1 gap-0.5">
        <Text variant="label" tone={tone}>
          {label}
        </Text>
        {detail ? (
          <Text variant="caption" tone="muted">
            {detail}
          </Text>
        ) : null}
      </View>
      {right}
      {onPress && !right ? <ChevronRight size={18} color={t.colors.muted} /> : null}
    </View>
  );
  return (
    <>
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={detail}
          onPress={onPress}
          className="active:bg-elevated"
        >
          {content}
        </Pressable>
      ) : (
        content
      )}
      {last ? null : <Divider />}
    </>
  );
}

export function Toggle({
  label,
  detail,
  value,
  onChange,
  last,
}: {
  label: string;
  detail?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
}) {
  const t = useTheme();
  return (
    <ListRow
      label={label}
      detail={detail}
      last={last}
      right={
        <Switch
          accessibilityLabel={label}
          value={value}
          onValueChange={(v) => {
            haptic.tap();
            onChange(v);
          }}
          trackColor={{ true: t.colors.accent, false: t.colors.hairline }}
          thumbColor={t.dark ? t.colors.fg : '#FFFFFF'}
        />
      }
    />
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      className="flex-row rounded-md border-hairline border-hairline bg-surface p-1"
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={o.label}
            onPress={() => {
              haptic.tap();
              onChange(o.value);
            }}
            className={`min-h-[36px] flex-1 items-center justify-center rounded-sm px-2 ${selected ? 'bg-elevated' : ''}`}
          >
            <Text variant="label" tone={selected ? 'fg' : 'muted'}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Badge({ label, tone = 'muted' }: { label: string; tone?: 'muted' | 'accent' | 'success' | 'warning' | 'danger' }) {
  const border = {
    muted: 'border-hairline',
    accent: 'border-accent',
    success: 'border-success',
    warning: 'border-warning',
    danger: 'border-danger',
  }[tone];
  return (
    <View className={`self-start rounded-full border-hairline ${border} px-2 py-0.5`}>
      <Text variant="caption" tone={tone === 'muted' ? 'muted' : tone}>
        {label}
      </Text>
    </View>
  );
}

import type { LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, Pressable, type PressableProps, View } from 'react-native';
import { haptic } from '../haptics';
import { useTheme } from '../ThemeProvider';
import { Text } from './Text';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BOX: Record<Variant, string> = {
  primary: 'bg-accent border-accent',
  secondary: 'bg-surface border-hairline',
  ghost: 'bg-transparent border-transparent',
  danger: 'bg-transparent border-danger',
};

export type ButtonProps = Omit<PressableProps, 'children'> & {
  title: string;
  variant?: Variant;
  icon?: LucideIcon;
  loading?: boolean;
  full?: boolean;
  size?: 'md' | 'sm';
  className?: string;
};

export function Button({
  title,
  variant = 'primary',
  icon: Icon,
  loading,
  full,
  size = 'md',
  disabled,
  onPress,
  className = '',
  ...rest
}: ButtonProps) {
  const t = useTheme();
  const tone = variant === 'primary' ? 'onAccent' : variant === 'danger' ? 'danger' : 'fg';
  const iconColor = variant === 'primary' ? t.colors.onAccent : variant === 'danger' ? t.colors.danger : t.colors.fg;
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={(e) => {
        haptic.tap();
        onPress?.(e);
      }}
      className={`flex-row items-center justify-center gap-2 rounded-md border-hairline ${BOX[variant]} ${
        size === 'sm' ? 'min-h-[36px] px-3' : 'min-h-[46px] px-4'
      } ${full ? 'w-full' : ''} ${inactive ? 'opacity-50' : 'active:opacity-80'} ${className}`}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={iconColor} />
      ) : Icon ? (
        <View accessibilityElementsHidden importantForAccessibility="no">
          <Icon size={size === 'sm' ? 16 : 18} color={iconColor} strokeWidth={1.75} />
        </View>
      ) : null}
      <Text variant="label" tone={tone}>
        {title}
      </Text>
    </Pressable>
  );
}

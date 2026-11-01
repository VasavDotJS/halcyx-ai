import type { LucideIcon } from 'lucide-react-native';
import { Pressable, type PressableProps } from 'react-native';
import { haptic } from '../haptics';
import { useTheme } from '../ThemeProvider';

export function IconButton({
  icon: Icon,
  label,
  tone = 'fg',
  active,
  onPress,
  disabled,
  ...rest
}: Omit<PressableProps, 'children'> & { icon: LucideIcon; label: string; tone?: 'fg' | 'muted' | 'accent' | 'danger'; active?: boolean }) {
  const t = useTheme();
  const color = { fg: t.colors.fg, muted: t.colors.muted, accent: t.colors.accent, danger: t.colors.danger }[tone];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: !!active }}
      hitSlop={8}
      disabled={disabled}
      onPress={(e) => {
        haptic.tap();
        onPress?.(e);
      }}
      className={`h-10 w-10 items-center justify-center rounded-md ${active ? 'bg-elevated' : ''} ${disabled ? 'opacity-40' : 'active:bg-elevated'}`}
      {...rest}
    >
      <Icon size={20} color={color} strokeWidth={1.75} />
    </Pressable>
  );
}

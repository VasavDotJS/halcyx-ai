import { Text as RNText, type TextProps } from 'react-native';

type Variant = 'display' | 'title' | 'heading' | 'body' | 'label' | 'caption' | 'mono' | 'monoSmall';
type Tone = 'fg' | 'muted' | 'accent' | 'danger' | 'success' | 'warning' | 'onAccent';

const VARIANT: Record<Variant, string> = {
  display: 'font-semibold text-[32px] leading-[38px] tracking-tight',
  title: 'font-semibold text-[22px] leading-[28px] tracking-tight',
  heading: 'font-semibold text-[17px] leading-[24px]',
  body: 'font-sans text-[15px] leading-[22px]',
  label: 'font-medium text-[14px] leading-[20px]',
  caption: 'font-sans text-[12px] leading-[16px]',
  mono: 'font-mono text-[13px] leading-[20px]',
  monoSmall: 'font-mono text-[11px] leading-[16px]',
};

const TONE: Record<Tone, string> = {
  fg: 'text-fg',
  muted: 'text-muted',
  accent: 'text-accent',
  danger: 'text-danger',
  success: 'text-success',
  warning: 'text-warning',
  onAccent: 'text-on-accent',
};

export type AppTextProps = TextProps & { variant?: Variant; tone?: Tone; className?: string };

/** Typography primitive. Font scaling stays enabled (Dynamic Type up to 200%+). */
export function Text({ variant = 'body', tone = 'fg', className = '', ...rest }: AppTextProps) {
  return <RNText allowFontScaling className={`${VARIANT[variant]} ${TONE[tone]} ${className}`} {...rest} />;
}

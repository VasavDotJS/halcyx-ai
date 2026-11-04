import { blend, ensureContrast, readableOn, toVarTriplet } from './color';

import type { ThemeName, ThemePreference } from '@/core/types';

export type { ThemeName, ThemePreference };

export type ColorTokens = {
  bg: string;
  surface: string;
  elevated: string;
  fg: string;
  muted: string;
  hairline: string;
  accent: string;
  onAccent: string;
  success: string;
  warning: string;
  danger: string;
  diffAdd: string;
  diffDel: string;
};

export type Theme = {
  name: ThemeName;
  label: string;
  dark: boolean;
  colors: ColorTokens;
  /** Two-stop accent gradient; only used as a subtle accent (Aurora). */
  gradient: [string, string] | null;
  radius: { sm: number; md: number; lg: number };
  spacing: { xs: number; sm: number; md: number; lg: number; xl: number };
  font: { sans: string; medium: string; semibold: string; mono: string };
  motion: { fast: number; base: number; slow: number };
};

const radius = { sm: 6, md: 10, lg: 16 };
const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
const font = {
  sans: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
  mono: 'GeistMono_400Regular',
};
const motion = { fast: 150, base: 200, slow: 250 };

type Palette = Omit<ColorTokens, 'diffAdd' | 'diffDel' | 'onAccent'> & { onAccent?: string };

function build(name: ThemeName, label: string, dark: boolean, p: Palette, gradient: Theme['gradient'] = null): Theme {
  return {
    name,
    label,
    dark,
    gradient,
    radius,
    spacing,
    font,
    motion,
    colors: {
      ...p,
      onAccent: p.onAccent ?? readableOn(p.accent),
      diffAdd: blend(p.success, p.bg, dark ? 0.16 : 0.12),
      diffDel: blend(p.danger, p.bg, dark ? 0.16 : 0.12),
    },
  };
}

export const THEMES: Record<ThemeName, Theme> = {
  midnight: build('midnight', 'Midnight', true, {
    bg: '#0A0A0A',
    surface: '#111111',
    elevated: '#1A1A1A',
    fg: '#EDEDED',
    muted: '#A1A1A1',
    hairline: '#2A2A2A',
    accent: '#52A8FF',
    success: '#3FCF8E',
    warning: '#F5B544',
    danger: '#FF6369',
  }),
  paper: build('paper', 'Paper', false, {
    bg: '#FFFFFF',
    surface: '#FAFAFA',
    elevated: '#FFFFFF',
    fg: '#171717',
    muted: '#5E5E5E',
    hairline: '#E5E5E5',
    accent: '#0062D1',
    success: '#0A7A43',
    warning: '#8F5A00',
    danger: '#C9252D',
  }),
  graphite: build('graphite', 'Graphite', true, {
    bg: '#1C1C1E',
    surface: '#232325',
    elevated: '#2C2C2E',
    fg: '#F2F2F7',
    muted: '#B0B0B6',
    hairline: '#3A3A3C',
    accent: '#E6E6EA',
    success: '#5ED39A',
    warning: '#F2C14E',
    danger: '#FF7A7F',
  }),
  aurora: build(
    'aurora',
    'Aurora',
    true,
    {
      bg: '#07070C',
      surface: '#0E0E16',
      elevated: '#161622',
      fg: '#ECECF4',
      muted: '#A3A3BC',
      hairline: '#262638',
      accent: '#9D8FFF',
      success: '#43D9AD',
      warning: '#F7C35F',
      danger: '#FF7088',
    },
    ['#6E56CF', '#1FA8A8'],
  ),
  'high-contrast': build('high-contrast', 'High Contrast', true, {
    bg: '#000000',
    surface: '#000000',
    elevated: '#0D0D0D',
    fg: '#FFFFFF',
    muted: '#E6E6E6',
    hairline: '#FFFFFF',
    accent: '#FFD60A',
    success: '#4DFFA6',
    warning: '#FFD60A',
    danger: '#FF8A8A',
  }),
};

export const THEME_ORDER: ThemeName[] = ['midnight', 'paper', 'graphite', 'aurora', 'high-contrast'];

export function resolveThemeName(pref: ThemePreference, systemDark: boolean): ThemeName {
  if (pref === 'system') return systemDark ? 'midnight' : 'paper';
  return pref;
}

/** Applies a user-picked accent while keeping WCAG AA against the theme background. */
export function withAccent(theme: Theme, accent: string | null): Theme {
  if (!accent) return theme;
  const safe = ensureContrast(accent, theme.colors.bg);
  return { ...theme, colors: { ...theme.colors, accent: safe, onAccent: readableOn(safe) } };
}

/** CSS variables consumed by tailwind.config.js (`--c-*`, `--r-*`). */
export function themeVars(theme: Theme): Record<string, string> {
  const c = theme.colors;
  return {
    '--c-bg': toVarTriplet(c.bg),
    '--c-surface': toVarTriplet(c.surface),
    '--c-elevated': toVarTriplet(c.elevated),
    '--c-fg': toVarTriplet(c.fg),
    '--c-muted': toVarTriplet(c.muted),
    '--c-hairline': toVarTriplet(c.hairline),
    '--c-accent': toVarTriplet(c.accent),
    '--c-on-accent': toVarTriplet(c.onAccent),
    '--c-success': toVarTriplet(c.success),
    '--c-warning': toVarTriplet(c.warning),
    '--c-danger': toVarTriplet(c.danger),
    '--c-diff-add': toVarTriplet(c.diffAdd),
    '--c-diff-del': toVarTriplet(c.diffDel),
    '--r-sm': `${theme.radius.sm}px`,
    '--r-md': `${theme.radius.md}px`,
    '--r-lg': `${theme.radius.lg}px`,
  };
}

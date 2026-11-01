/** Colors resolve to CSS variables set live by ui/ThemeProvider, so themes switch without restart. */
const token = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './ui/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        bg: token('bg'),
        surface: token('surface'),
        elevated: token('elevated'),
        fg: token('fg'),
        muted: token('muted'),
        hairline: token('hairline'),
        accent: token('accent'),
        'on-accent': token('on-accent'),
        success: token('success'),
        warning: token('warning'),
        danger: token('danger'),
        'diff-add': token('diff-add'),
        'diff-del': token('diff-del'),
      },
      fontFamily: {
        sans: ['Geist_400Regular'],
        medium: ['Geist_500Medium'],
        semibold: ['Geist_600SemiBold'],
        mono: ['GeistMono_400Regular'],
      },
      borderRadius: { sm: 'var(--r-sm)', md: 'var(--r-md)', lg: 'var(--r-lg)' },
      borderWidth: { hairline: '1px' },
    },
  },
  plugins: [],
};

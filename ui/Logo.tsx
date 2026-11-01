import { Image } from 'react-native';
import { useTheme } from './ThemeProvider';

const WORDMARK = require('../assets/wordmark-light.png') as number;
const RATIO = 1207 / 212;

/** HALCYX wordmark, tinted to the theme's foreground color. */
export function Logo({ height = 22 }: { height?: number }) {
  const t = useTheme();
  return (
    <Image
      source={WORDMARK}
      accessibilityRole="image"
      accessibilityLabel="HALCYX"
      style={{ height, width: height * RATIO, tintColor: t.colors.fg }}
      resizeMode="contain"
    />
  );
}

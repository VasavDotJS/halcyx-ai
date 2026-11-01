/** Small color utilities used by the theme system and the WCAG contrast tests. */

export type Rgb = { r: number; g: number; b: number };

export function hexToRgb(hex: string): Rgb {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`Invalid hex color: ${hex}`);
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const h = (v: number) =>
    Math.round(Math.max(0, Math.min(255, v)))
      .toString(16)
      .padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

/** "r g b" triplet for CSS variables consumed by tailwind's `rgb(var(--x) / alpha)`. */
export function toVarTriplet(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return `${r} ${g} ${b}`;
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.x contrast ratio between two opaque colors. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Blend `top` over `bottom` with the given opacity (used for tinted diff backgrounds). */
export function blend(top: string, bottom: string, alpha: number): string {
  const t = hexToRgb(top);
  const b = hexToRgb(bottom);
  return rgbToHex({
    r: t.r * alpha + b.r * (1 - alpha),
    g: t.g * alpha + b.g * (1 - alpha),
    b: t.b * alpha + b.b * (1 - alpha),
  });
}

/** Pick black or white text, whichever reads better on `bg`. */
export function readableOn(bg: string, dark = '#0A0A0A', light = '#FFFFFF'): string {
  return contrast(bg, dark) >= contrast(bg, light) ? dark : light;
}

/**
 * Nudge `color` toward white or black until it reaches `min` contrast against `bg`.
 * Used for user-picked accent colors so custom accents stay WCAG AA.
 */
export function ensureContrast(color: string, bg: string, min = 4.5): string {
  if (contrast(color, bg) >= min) return color.toUpperCase();
  const target = luminance(bg) < 0.5 ? '#FFFFFF' : '#000000';
  for (let step = 1; step <= 20; step += 1) {
    const candidate = blend(target, color, step / 20);
    if (contrast(candidate, bg) >= min) return candidate;
  }
  return target;
}

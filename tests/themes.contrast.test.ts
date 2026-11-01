import { contrast, ensureContrast } from '@/ui/color';
import { THEMES, THEME_ORDER, withAccent } from '@/ui/themes';

const AA = 4.5;

describe('WCAG AA contrast in every theme', () => {
  for (const name of THEME_ORDER) {
    const c = THEMES[name].colors;
    const pairs: [string, string, string][] = [
      ['fg on bg', c.fg, c.bg],
      ['fg on surface', c.fg, c.surface],
      ['fg on elevated', c.fg, c.elevated],
      ['muted on bg', c.muted, c.bg],
      ['muted on surface', c.muted, c.surface],
      ['accent on bg', c.accent, c.bg],
      ['onAccent on accent', c.onAccent, c.accent],
      ['success on bg', c.success, c.bg],
      ['warning on bg', c.warning, c.bg],
      ['danger on bg', c.danger, c.bg],
      ['fg on diffAdd', c.fg, c.diffAdd],
      ['fg on diffDel', c.fg, c.diffDel],
    ];
    for (const [label, a, b] of pairs) {
      it(`${name}: ${label} >= ${AA}`, () => {
        expect(contrast(a, b)).toBeGreaterThanOrEqual(AA);
      });
    }
  }
});

describe('custom accent picker', () => {
  it.each(['#FFFF00', '#111111', '#7F7F7F', '#00FF66', '#2200AA'])('keeps %s readable in every theme', (accent) => {
    for (const name of THEME_ORDER) {
      const t = withAccent(THEMES[name], accent);
      expect(contrast(t.colors.accent, t.colors.bg)).toBeGreaterThanOrEqual(AA);
      expect(contrast(t.colors.onAccent, t.colors.accent)).toBeGreaterThanOrEqual(AA);
    }
  });

  it('leaves an already-readable color unchanged', () => {
    expect(ensureContrast('#FFFFFF', '#000000')).toBe('#FFFFFF');
  });
});

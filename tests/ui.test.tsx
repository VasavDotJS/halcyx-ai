import { fireEvent, render, screen } from '@testing-library/react-native';
import { computeHunks } from '@/core/workspace/diff';
import { formatRemaining } from '@/ui/Countdown';
import { DiffView } from '@/ui/DiffView';
import { shortcutFor } from '@/hooks/useKeyboardShortcuts';
import { splitFences } from '@/ui/MessageText';
import { ThemeProvider } from '@/ui/ThemeProvider';

const wrap = async (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('DiffView', () => {
  const hunks = computeHunks('a\nb\nc\n', 'a\nB\nc\nd\n');

  it('announces added and removed lines to screen readers (not color alone)', async () => {
    await wrap(<DiffView hunks={hunks} mode="unified" rejected={new Set()} />);
    expect(screen.getByLabelText('Removed line 2: b')).toBeTruthy();
    expect(screen.getByLabelText('Added line 2: B')).toBeTruthy();
    expect(screen.getByLabelText('Added line 4: d')).toBeTruthy();
  });

  it('toggles a hunk', async () => {
    const onToggle = jest.fn();
    await wrap(<DiffView hunks={hunks} mode="split" rejected={new Set()} onToggleHunk={onToggle} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Accepted' }));
    expect(onToggle).toHaveBeenCalledWith(0);
  });
});

describe('message rendering helpers', () => {
  it('splits fenced code from prose', () => {
    expect(splitFences('Here:\n```ts\nconst a = 1;\n```\nDone.')).toEqual([
      { kind: 'text', text: 'Here:\n' },
      { kind: 'code', lang: 'ts', text: 'const a = 1;\n' },
      { kind: 'text', text: '\nDone.' },
    ]);
  });

  it('formats the erase countdown', () => {
    expect(formatRemaining(0)).toBe('expired');
    expect(formatRemaining(90 * 60_000)).toBe('1h 30m');
    expect(formatRemaining(73 * 3_600_000)).toBe('3d 1h');
  });
});

describe('keyboard shortcuts', () => {
  it('maps ⌘/Ctrl + key to routes and ignores plain keys', () => {
    expect(shortcutFor({ key: '3', metaKey: true })).toBe('/(tabs)/review');
    expect(shortcutFor({ key: 'K', ctrlKey: true })).toBe('/(tabs)/chat');
    expect(shortcutFor({ key: '3' })).toBeNull();
    expect(shortcutFor({ key: '3', metaKey: true, shiftKey: true })).toBeNull();
  });
});

import { Check, Undo2 } from 'lucide-react-native';
import { memo } from 'react';
import { ScrollView, View } from 'react-native';
import { type DiffLine, type Hunk, toSplitRows } from '@/core/workspace/diff';
import { Button } from './primitives/Button';
import { Text } from './primitives/Text';

const lineBg = (k: DiffLine['kind']) => (k === '+' ? 'bg-diff-add' : k === '-' ? 'bg-diff-del' : '');
const sign = (k: DiffLine['kind']) => (k === ' ' ? ' ' : k);
const a11y = (l: DiffLine) =>
  `${l.kind === '+' ? 'Added' : l.kind === '-' ? 'Removed' : 'Unchanged'} line ${l.newNo ?? l.oldNo ?? ''}: ${l.text}`;

const UnifiedLine = memo(function UnifiedLine({ l }: { l: DiffLine }) {
  return (
    <View accessible accessibilityLabel={a11y(l)} className={`flex-row ${lineBg(l.kind)}`}>
      <Text variant="monoSmall" tone="muted" className="w-10 pr-1 text-right">
        {l.oldNo ?? ''}
      </Text>
      <Text variant="monoSmall" tone="muted" className="w-10 pr-1 text-right">
        {l.newNo ?? ''}
      </Text>
      <Text variant="mono" className="w-4 text-center" tone={l.kind === '+' ? 'success' : l.kind === '-' ? 'danger' : 'muted'}>
        {sign(l.kind)}
      </Text>
      <Text variant="mono" selectable className="pr-4">
        {l.text || ' '}
      </Text>
    </View>
  );
});

function SplitHunk({ hunk }: { hunk: Hunk }) {
  return (
    <View>
      {toSplitRows(hunk).map((r, i) => (
        <View key={i} className="flex-row">
          {[r.left, r.right].map((l, side) => (
            <View
              key={side}
              accessible
              accessibilityLabel={l ? a11y(l) : 'Empty'}
              className={`flex-1 flex-row ${l && l.kind !== ' ' ? lineBg(l.kind) : ''} ${side === 0 ? 'border-r-hairline border-hairline' : ''}`}
            >
              <Text variant="monoSmall" tone="muted" className="w-9 pr-1 text-right">
                {(side === 0 ? l?.oldNo : l?.newNo) ?? ''}
              </Text>
              <Text variant="mono" selectable numberOfLines={1} className="flex-1 pr-2">
                {l?.text ?? ''}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/** Unified or split diff with per-hunk accept/reject. Signs (+/−) back up color for accessibility. */
export function DiffView({
  hunks,
  mode,
  rejected,
  onToggleHunk,
}: {
  hunks: Hunk[];
  mode: 'unified' | 'split';
  rejected: ReadonlySet<number>;
  onToggleHunk?: (index: number) => void;
}) {
  if (!hunks.length) {
    return (
      <Text tone="muted" className="p-4">
        No textual changes.
      </Text>
    );
  }
  return (
    <View className="gap-3">
      {hunks.map((h) => {
        const isRejected = rejected.has(h.index);
        return (
          <View key={h.index} className={`overflow-hidden rounded-md border-hairline border-hairline ${isRejected ? 'opacity-50' : ''}`}>
            <View className="flex-row items-center justify-between bg-elevated px-3 py-1.5">
              <Text variant="monoSmall" tone="muted">
                @@ −{h.oldStart},{h.oldLines} +{h.newStart},{h.newLines} @@
              </Text>
              {onToggleHunk ? (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={isRejected ? Undo2 : Check}
                  title={isRejected ? 'Rejected · undo' : 'Accepted'}
                  accessibilityHint="Toggles whether this hunk is included in the commit"
                  onPress={() => onToggleHunk(h.index)}
                />
              ) : null}
            </View>
            {mode === 'split' ? (
              <SplitHunk hunk={h} />
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View>
                  {h.lines.map((l, i) => (
                    <UnifiedLine key={i} l={l} />
                  ))}
                </View>
              </ScrollView>
            )}
          </View>
        );
      })}
    </View>
  );
}

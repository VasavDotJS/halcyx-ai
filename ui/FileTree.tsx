import { FileMinus, FilePen, FilePlus } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import type { WorkspaceFile } from '@/core/workspace/store';
import { Text } from './primitives/Text';
import { useTheme } from './ThemeProvider';

/** Changed-file list grouped by directory; selection drives the diff pane. */
export function FileTree({
  files,
  selectedId,
  onSelect,
  stats,
}: {
  files: WorkspaceFile[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  stats: Record<string, { additions: number; deletions: number } | undefined>;
}) {
  const t = useTheme();
  const groups = new Map<string, WorkspaceFile[]>();
  for (const f of files) {
    const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '.';
    groups.set(dir, [...(groups.get(dir) ?? []), f]);
  }
  return (
    <View className="gap-2">
      {[...groups].map(([dir, list]) => (
        <View key={dir} className="gap-0.5">
          <Text variant="monoSmall" tone="muted" className="px-2">
            {dir}/
          </Text>
          {list.map((f) => {
            const Icon = f.change === 'added' ? FilePlus : f.change === 'deleted' ? FileMinus : FilePen;
            const color = f.change === 'added' ? t.colors.success : f.change === 'deleted' ? t.colors.danger : t.colors.warning;
            const s = stats[f.id];
            const name = f.path.slice(f.path.lastIndexOf('/') + 1);
            const selected = f.id === selectedId;
            return (
              <Pressable
                key={f.id}
                onPress={() => onSelect(f.id)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${name}, ${f.change}${f.decision === 'rejected' ? ', rejected' : ''}`}
                className={`min-h-[40px] flex-row items-center gap-2 rounded-sm px-2 ${selected ? 'bg-elevated' : 'active:bg-elevated'}`}
              >
                <Icon size={16} color={color} strokeWidth={1.75} />
                <Text variant="mono" numberOfLines={1} className={`flex-1 ${f.decision === 'rejected' ? 'line-through opacity-60' : ''}`}>
                  {name}
                </Text>
                {s ? (
                  <Text variant="monoSmall">
                    <Text variant="monoSmall" tone="success">
                      +{s.additions}
                    </Text>{' '}
                    <Text variant="monoSmall" tone="danger">
                      −{s.deletions}
                    </Text>
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

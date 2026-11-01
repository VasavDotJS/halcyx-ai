import { View } from 'react-native';
import { CodeBlock } from './CodeBlock';
import { Text } from './primitives/Text';

type Part = { kind: 'text'; text: string } | { kind: 'code'; text: string; lang: string };

export function splitFences(src: string): Part[] {
  const parts: Part[] = [];
  const re = /```([\w+-]*)\n([\s\S]*?)(```|$)/g;
  let last = 0;
  for (const m of src.matchAll(re)) {
    if (m.index! > last) parts.push({ kind: 'text', text: src.slice(last, m.index) });
    parts.push({ kind: 'code', lang: m[1] || 'plain', text: m[2] ?? '' });
    last = m.index! + m[0].length;
  }
  if (last < src.length) parts.push({ kind: 'text', text: src.slice(last) });
  return parts.filter((p) => p.text.trim().length > 0);
}

/** Streaming agent text with fenced code blocks rendered as highlighted, copyable blocks. */
export function MessageText({ text }: { text: string }) {
  return (
    <View className="gap-3">
      {splitFences(text).map((p, i) =>
        p.kind === 'code' ? (
          <CodeBlock key={i} code={p.text} language={p.lang} />
        ) : (
          <Text key={i} selectable>
            {p.text.trim()}
          </Text>
        ),
      )}
    </View>
  );
}

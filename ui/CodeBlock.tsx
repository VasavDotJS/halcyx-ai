import * as Clipboard from 'expo-clipboard';
import { Check, Copy } from 'lucide-react-native';
import { Highlight } from 'prism-react-renderer';
import { useState } from 'react';
import { ScrollView, Text as RNText, View } from 'react-native';
import { IconButton } from './primitives/IconButton';
import { Text } from './primitives/Text';
import { syntaxColors } from './syntax';
import { useTheme } from './ThemeProvider';

/** Syntax-highlighted code block with copy, used in chat messages. */
export function CodeBlock({ code, language = 'plain', title }: { code: string; language?: string; title?: string }) {
  const t = useTheme();
  const colors = syntaxColors(t);
  const [copied, setCopied] = useState(false);
  return (
    <View className="overflow-hidden rounded-md border-hairline border-hairline bg-surface">
      <View className="flex-row items-center justify-between border-b-hairline border-hairline pl-3">
        <Text variant="monoSmall" tone="muted">
          {title ?? language}
        </Text>
        <IconButton
          icon={copied ? Check : Copy}
          label={copied ? 'Copied' : 'Copy code'}
          tone="muted"
          onPress={async () => {
            await Clipboard.setStringAsync(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Highlight code={code.replace(/\n$/, '')} language={language} theme={{ plain: { color: t.colors.fg }, styles: [] }}>
          {({ tokens, getTokenProps }) => (
            <View className="px-3 py-2">
              {tokens.map((line, i) => (
                <RNText key={i} allowFontScaling className="font-mono text-[13px] leading-[20px]" selectable>
                  {line.map((token, k) => {
                    const p = getTokenProps({ token });
                    const type = token.types.find((ty) => colors[ty]);
                    return (
                      <RNText key={k} style={{ color: type ? colors[type] : t.colors.fg }}>
                        {p.children}
                      </RNText>
                    );
                  })}
                </RNText>
              ))}
            </View>
          )}
        </Highlight>
      </ScrollView>
    </View>
  );
}

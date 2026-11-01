import { Check } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSettings } from '@/state/settings';
import { Input, Screen, Section, Segmented, Text, Toggle } from '@/ui/primitives';
import { useTheme } from '@/ui/ThemeProvider';
import { THEME_ORDER, THEMES, type ThemePreference } from '@/ui/themes';

const ACCENTS = ['#52A8FF', '#9D8FFF', '#FF6BB5', '#FF8A3D', '#F5D90A', '#3FCF8E', '#2EC4D6'];

export default function Appearance() {
  const t = useTheme();
  const s = useSettings();
  const [hex, setHex] = useState(s.accent ?? '');

  return (
    <Screen title="Appearance">
      <Segmented<'system' | 'manual'>
        label="Theme source"
        value={s.theme === 'system' ? 'system' : 'manual'}
        onChange={(v) => s.update({ theme: v === 'system' ? 'system' : t.name })}
        options={[
          { value: 'system', label: 'Follow system' },
          { value: 'manual', label: 'Choose' },
        ]}
      />
      <View className="flex-row flex-wrap gap-3" accessibilityRole="radiogroup" accessibilityLabel="Theme">
        {THEME_ORDER.map((name) => {
          const th = THEMES[name];
          const selected = s.theme === name || (s.theme === 'system' && t.name === name);
          return (
            <Pressable
              key={name}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={th.label}
              onPress={() => s.update({ theme: name as ThemePreference })}
              className={`w-[47%] gap-2 rounded-lg border p-3 ${selected ? 'border-accent' : 'border-hairline'}`}
              style={{ backgroundColor: th.colors.bg }}
            >
              <View
                className="h-14 justify-end gap-1 rounded-md p-2"
                style={{ backgroundColor: th.colors.surface, borderColor: th.colors.hairline, borderWidth: 1 }}
              >
                <View className="h-1.5 w-2/3 rounded-full" style={{ backgroundColor: th.colors.fg }} />
                <View className="h-1.5 w-1/3 rounded-full" style={{ backgroundColor: th.gradient ? th.gradient[0] : th.colors.accent }} />
              </View>
              <View className="flex-row items-center justify-between">
                <Text variant="label" style={{ color: th.colors.fg }}>
                  {th.label}
                </Text>
                {selected ? <Check size={16} color={th.colors.accent} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      <Section title="Accent color" footer="Custom accents are adjusted automatically to stay WCAG AA readable in every theme.">
        <View className="flex-row flex-wrap gap-3 p-4">
          <Pressable
            accessibilityRole="radio"
            accessibilityLabel="Theme default accent"
            accessibilityState={{ selected: !s.accent }}
            onPress={() => s.update({ accent: null })}
            className={`h-9 w-9 items-center justify-center rounded-full border ${!s.accent ? 'border-fg' : 'border-hairline'}`}
          >
            <Text variant="caption">A</Text>
          </Pressable>
          {ACCENTS.map((c) => (
            <Pressable
              key={c}
              accessibilityRole="radio"
              accessibilityLabel={`Accent ${c}`}
              accessibilityState={{ selected: s.accent === c }}
              onPress={() => s.update({ accent: c })}
              className={`h-9 w-9 rounded-full border-2 ${s.accent === c ? 'border-fg' : 'border-transparent'}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </View>
        <View className="px-4 pb-4">
          <Input
            label="Custom hex"
            value={hex}
            onChangeText={(v) => {
              setHex(v);
              if (/^#[0-9A-Fa-f]{6}$/.test(v)) s.update({ accent: v.toUpperCase() });
            }}
            placeholder="#52A8FF"
            autoCapitalize="characters"
            mono
          />
        </View>
      </Section>

      <Section title="Feel">
        <Toggle label="Haptics" detail="On send, approve and push" value={s.haptics} onChange={(v) => s.update({ haptics: v })} />
        <Toggle
          label="Return key sends"
          detail="Otherwise use ⌘/Ctrl + Return"
          value={s.sendWithReturn}
          onChange={(v) => s.update({ sendWithReturn: v })}
          last
        />
      </Section>
    </Screen>
  );
}

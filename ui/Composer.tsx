import * as ImagePicker from 'expo-image-picker';
import { ArrowUp, ImagePlus, Mic, MicOff, X } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Image, Platform, Pressable, TextInput, View } from 'react-native';
import { matchSlash } from '@/core/prompts/slash';
import type { ImageInput } from '@/core/types';
import { useSettings } from '@/state/settings';
import { haptic } from './haptics';
import { IconButton } from './primitives/IconButton';
import { MAX_FONT_SCALE, Text } from './primitives/Text';
import { useTheme } from './ThemeProvider';
import { useDictation } from './useDictation';

export type ComposerSubmit = { text: string; images: ImageInput[] };

/** Centered chat composer: slash commands, on-device dictation, screenshot/sketch attachments. */
export function Composer({
  onSubmit,
  placeholder = 'Describe a task…',
  disabled,
  allowImages = true,
  footer,
}: {
  onSubmit: (v: ComposerSubmit) => void;
  placeholder?: string;
  disabled?: boolean;
  allowImages?: boolean;
  footer?: React.ReactNode;
}) {
  const t = useTheme();
  const sendWithReturn = useSettings((s) => s.sendWithReturn);
  const [text, setText] = useState('');
  const [images, setImages] = useState<(ImageInput & { uri: string })[]>([]);
  const base = useRef('');
  const dictation = useDictation((spoken, final) => {
    const next = `${base.current}${base.current && !base.current.endsWith(' ') ? ' ' : ''}${spoken}`;
    setText(next);
    if (final) base.current = next;
  });
  const suggestions = matchSlash(text);
  const canSend = !disabled && text.trim().length > 0;

  const submit = () => {
    if (!canSend) return;
    haptic.impact();
    onSubmit({ text: text.trim(), images: images.map(({ mimeType, base64 }) => ({ mimeType, base64 })) });
    setText('');
    setImages([]);
    base.current = '';
  };

  const pickImage = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      base64: true,
      quality: 0.7,
      allowsMultipleSelection: true,
      selectionLimit: 3,
    });
    if (res.canceled) return;
    setImages((prev) =>
      [
        ...prev,
        ...res.assets.filter((a) => a.base64).map((a) => ({ uri: a.uri, base64: a.base64!, mimeType: a.mimeType ?? 'image/jpeg' })),
      ].slice(0, 3),
    );
  };

  return (
    <View className="gap-2">
      {suggestions.length ? (
        <View className="overflow-hidden rounded-md border-hairline border-hairline bg-elevated">
          {suggestions.map((s) => (
            <Pressable
              key={s.name}
              accessibilityRole="button"
              accessibilityLabel={`${s.name}: ${s.hint}`}
              onPress={() => setText(`${s.name} `)}
              className="flex-row gap-3 px-3 py-2.5 active:bg-surface"
            >
              <Text variant="mono" tone="accent">
                {s.name}
              </Text>
              <Text tone="muted">{s.hint}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View className="rounded-lg border-hairline border-hairline bg-surface p-2">
        {images.length ? (
          <View className="flex-row gap-2 px-1 pb-2">
            {images.map((img, i) => (
              <View key={img.uri}>
                <Image source={{ uri: img.uri }} accessibilityLabel={`Attachment ${i + 1}`} className="h-14 w-14 rounded-sm" />
                <Pressable
                  accessibilityLabel={`Remove attachment ${i + 1}`}
                  onPress={() => setImages((p) => p.filter((x) => x.uri !== img.uri))}
                  className="absolute -right-1.5 -top-1.5 h-5 w-5 items-center justify-center rounded-full bg-fg"
                >
                  <X size={12} color={t.colors.bg} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
        <TextInput
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          value={text}
          onChangeText={(v) => {
            setText(v);
            base.current = v;
          }}
          placeholder={placeholder}
          placeholderTextColor={t.colors.muted}
          selectionColor={t.colors.accent}
          multiline
          accessibilityLabel="Task prompt"
          editable={!disabled}
          submitBehavior={sendWithReturn ? 'submit' : 'newline'}
          onSubmitEditing={sendWithReturn ? submit : undefined}
          onKeyPress={(e) => {
            const ne = e.nativeEvent as { key: string; metaKey?: boolean; ctrlKey?: boolean };
            if (ne.key === 'Enter' && (ne.metaKey || ne.ctrlKey)) submit();
          }}
          className="max-h-[180px] min-h-[52px] px-2 py-2 font-sans text-[15px] leading-[22px] text-fg"
        />
        <View className="flex-row items-center justify-between">
          <View className="flex-row">
            {allowImages ? <IconButton icon={ImagePlus} label="Attach screenshot or sketch" tone="muted" onPress={pickImage} /> : null}
            {Platform.OS !== 'web' ? (
              <IconButton
                icon={dictation.listening ? MicOff : Mic}
                label={dictation.listening ? 'Stop dictation' : 'Dictate'}
                tone={dictation.listening ? 'accent' : 'muted'}
                active={dictation.listening}
                onPress={dictation.listening ? dictation.stop : dictation.start}
              />
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={submit}
            className={`h-9 w-9 items-center justify-center rounded-full ${canSend ? 'bg-accent' : 'bg-elevated'}`}
          >
            <ArrowUp size={18} color={canSend ? t.colors.onAccent : t.colors.muted} strokeWidth={2} />
          </Pressable>
        </View>
      </View>
      {dictation.error ? (
        <Text variant="caption" tone="danger">
          {dictation.error}
        </Text>
      ) : null}
      {footer}
    </View>
  );
}

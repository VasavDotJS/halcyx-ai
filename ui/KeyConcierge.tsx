import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { CircleCheck, Circle, ClipboardPaste, ExternalLink, FolderPlus, KeyRound, LogIn, ShieldCheck } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, View } from 'react-native';
import { extractKey, maskKey } from '@/core/security/keyFormat';
import { useReadyServices } from '@/hooks/useServices';
import { useSettings } from '@/state/settings';
import { haptic } from './haptics';
import { Button, Card, Input, Text, Toggle } from './primitives';
import { useTheme } from './ThemeProvider';

const STEPS = [
  { icon: LogIn, title: 'Sign in to Google AI Studio', body: 'Use the Google account you want billed.' },
  { icon: KeyRound, title: 'Tap “Create API key”', body: 'It’s on the API keys page that just opened.' },
  { icon: FolderPlus, title: 'Choose or create a project', body: 'Any Google Cloud project works; a new one is fine.' },
  { icon: ClipboardPaste, title: 'Copy the key', body: 'It starts with “AIza”. Come back here — we’ll detect it.' },
];

/** Guided Gemini key setup for non-experts (spec §3.2 "Google key concierge"). */
export function GoogleKeyConcierge({ onDone }: { onDone: () => void }) {
  const s = useReadyServices();
  const t = useTheme();
  const billingReminder = useSettings((x) => x.billingReminder);
  const update = useSettings((x) => x.update);
  const [checked, setChecked] = useState<boolean[]>(STEPS.map(() => false));
  const [detected, setDetected] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [state, setState] = useState<'idle' | 'checking' | 'saved' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [showRecovery, setShowRecovery] = useState(false);

  const checkClipboard = useCallback(async () => {
    if (!(await Clipboard.hasStringAsync())) return;
    const key = extractKey('gemini', await Clipboard.getStringAsync());
    if (key) {
      setDetected(key);
      setChecked(STEPS.map(() => true));
    }
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') void checkClipboard();
    });
    return () => sub.remove();
  }, [checkClipboard]);

  const save = async (key: string, fromClipboard: boolean) => {
    setState('checking');
    setMessage(null);
    const result = await s.keys.validateCandidate('gemini', key, s.fetch, s.isWeb);
    if (result.status === 'invalid' || result.status === 'network_error') {
      setState('error');
      setMessage(
        result.status === 'invalid'
          ? 'Google rejected that key. Copy it again from AI Studio.'
          : 'No connection — try again when you’re online.',
      );
      return;
    }
    await s.keys.set('gemini', key);
    await s.keys.validate('gemini', s.fetch, s.isWeb);
    if (fromClipboard) await Clipboard.setStringAsync('');
    haptic.success();
    setState('saved');
    setMessage(result.status === 'quota_exceeded' ? 'Saved. Your project is out of quota right now — check billing in AI Studio.' : null);
  };

  return (
    <View className="gap-4">
      <Card className="gap-2">
        <Text variant="heading">What’s an API key?</Text>
        <Text tone="muted">
          An API key is a password that lets HALCYX talk to Gemini on your behalf. Usage is billed to your own Google account, and the key
          is stored only on this device.
        </Text>
      </Card>

      <Button
        title="Open Google AI Studio"
        icon={ExternalLink}
        onPress={async () => {
          await WebBrowser.openBrowserAsync('https://aistudio.google.com/apikey', {
            presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
          });
          await checkClipboard();
        }}
      />

      <View className="gap-1" accessibilityRole="list">
        {STEPS.map((step, i) => {
          const Icon = step.icon;
          const done = checked[i];
          return (
            <Pressable
              key={step.title}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: done }}
              accessibilityLabel={`Step ${i + 1}: ${step.title}`}
              onPress={() => setChecked((c) => c.map((v, j) => (j === i ? !v : v)))}
              className="flex-row items-start gap-3 rounded-md px-2 py-2.5 active:bg-surface"
            >
              <View className="h-9 w-9 items-center justify-center rounded-md border-hairline border-hairline bg-surface">
                <Icon size={18} color={t.colors.fg} strokeWidth={1.75} />
              </View>
              <View className="flex-1">
                <Text variant="label">
                  {i + 1}. {step.title}
                </Text>
                <Text variant="caption" tone="muted">
                  {step.body}
                </Text>
              </View>
              {done ? <CircleCheck size={20} color={t.colors.success} /> : <Circle size={20} color={t.colors.hairline} />}
            </Pressable>
          );
        })}
      </View>

      {detected && state !== 'saved' ? (
        <Card className="gap-3 border-accent">
          <Text variant="heading">Use this key?</Text>
          <Text variant="mono">{maskKey(detected)}</Text>
          <Text variant="caption" tone="muted">
            We found it on your clipboard. We’ll clear the clipboard after saving.
          </Text>
          <View className="flex-row gap-2">
            <Button title="Not this one" variant="secondary" className="flex-1" onPress={() => setDetected(null)} />
            <Button title="Use key" className="flex-1" loading={state === 'checking'} onPress={() => save(detected, true)} />
          </View>
        </Card>
      ) : null}

      {state !== 'saved' ? (
        <View className="gap-2">
          <Input
            label="Or paste it here"
            value={manual}
            onChangeText={setManual}
            placeholder="AIza…"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            mono
          />
          <Button
            title="Validate & save"
            variant="secondary"
            disabled={!manual}
            loading={state === 'checking'}
            onPress={() => save(manual.trim(), false)}
          />
        </View>
      ) : (
        <Card className="flex-row items-center gap-3 border-success">
          <ShieldCheck size={22} color={t.colors.success} />
          <Text className="flex-1">Your key is saved on this device only.</Text>
        </Card>
      )}

      {message ? (
        <Text tone={state === 'error' ? 'danger' : 'warning'} accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}

      <View className="overflow-hidden rounded-lg border-hairline border-hairline bg-surface">
        <Toggle
          label="Remind me to review usage & billing"
          detail="A monthly local reminder — nothing is sent anywhere."
          value={billingReminder}
          onChange={(v) => update({ billingReminder: v })}
          last
        />
      </View>

      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showRecovery }} onPress={() => setShowRecovery((v) => !v)}>
        <Text tone="accent">Lost your key?</Text>
      </Pressable>
      {showRecovery ? (
        <Text tone="muted">
          Keys can’t be recovered, but you can make a new one in seconds: open AI Studio › API keys, create a key in the same project, then
          paste it here. Delete the old key there if you think it leaked — HALCYX never stores a copy anywhere else.
        </Text>
      ) : null}

      {state === 'saved' ? <Button title="Continue" full onPress={onDone} /> : null}
    </View>
  );
}

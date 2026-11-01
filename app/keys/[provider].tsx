import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Eye, EyeOff, RefreshCw, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { PROVIDERS } from '@/core/providers/registry';
import { authenticate } from '@/core/security/biometrics';
import { maskKey } from '@/core/security/keyFormat';
import type { ProviderId } from '@/core/types';
import { useReadyServices } from '@/hooks/useServices';
import { haptic } from '@/ui/haptics';
import { GoogleKeyConcierge } from '@/ui/KeyConcierge';
import { Button, Card, Input, Row, Screen, Text } from '@/ui/primitives';
import { relativeTime } from '@/ui/TaskList';

const HELP: Record<ProviderId, string> = {
  gemini: 'Create a key in Google AI Studio.',
  anthropic: 'Create a key in the Claude Console › API keys. Managed Agents must be enabled for your organization.',
  openai: 'Create a key at platform.openai.com › API keys. OpenAI runs as tool-calling chat (no cloud sandbox).',
};

export default function KeyDetail() {
  const { provider } = useLocalSearchParams<{ provider: ProviderId }>();
  const s = useReadyServices();
  const qc = useQueryClient();
  const adapter = PROVIDERS[provider];
  const [revealed, setRevealed] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success' | 'warning'; text: string } | null>(null);

  const state = useQuery({
    queryKey: ['key', provider],
    queryFn: async () => {
      const key = await s.keys.get(provider);
      return { masked: key ? maskKey(key) : null, status: await s.keys.status(provider) };
    },
  });
  const refresh = () => {
    void state.refetch();
    void qc.invalidateQueries({ queryKey: ['keys'] });
  };

  const save = async () => {
    setBusy('save');
    setMsg(null);
    try {
      const v = await s.keys.validateCandidate(provider, value, s.fetch, s.isWeb);
      if (v.status === 'invalid') throw new Error(v.message ?? 'The provider rejected this key.');
      await s.keys.set(provider, value);
      await s.keys.validate(provider, s.fetch, s.isWeb);
      setValue('');
      setReplacing(false);
      haptic.success();
      setMsg({
        tone: v.status === 'quota_exceeded' ? 'warning' : 'success',
        text: v.status === 'quota_exceeded' ? 'Saved, but the account is out of quota.' : 'Saved on this device only.',
      });
      refresh();
    } catch (e) {
      setMsg({ tone: 'danger', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  if (!adapter) return null;
  const has = !!state.data?.masked;

  if (provider === 'gemini' && !has && !replacing) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Gemini key' }} />
        <GoogleKeyConcierge
          onDone={() => {
            refresh();
            router.back();
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: adapter.label }} />
      {has && !replacing ? (
        <Card className="gap-3">
          <Row>
            <Text variant="mono" selectable={!!revealed} className="flex-1">
              {revealed ?? state.data!.masked}
            </Text>
            <Button
              size="sm"
              variant="ghost"
              icon={revealed ? EyeOff : Eye}
              title={revealed ? 'Hide' : 'Reveal'}
              onPress={async () => {
                if (revealed) return setRevealed(null);
                if (await authenticate('Reveal API key')) {
                  setRevealed(await s.keys.get(provider));
                  setTimeout(() => setRevealed(null), 20_000);
                }
              }}
            />
          </Row>
          <Text variant="caption" tone="muted">
            {state.data?.status
              ? `Status: ${state.data.status.status.replace('_', ' ')} · checked ${relativeTime(state.data.status.checkedAt)}`
              : 'Not checked yet'}
          </Text>
          <Button
            title="Check now"
            variant="secondary"
            icon={RefreshCw}
            loading={busy === 'check'}
            onPress={async () => {
              setBusy('check');
              await s.keys.validate(provider, s.fetch, s.isWeb);
              setBusy(null);
              refresh();
            }}
          />
          <Row>
            <Button title="Rotate" variant="secondary" className="flex-1" onPress={() => setReplacing(true)} />
            <Button
              title="Delete"
              variant="danger"
              icon={Trash2}
              className="flex-1"
              onPress={async () => {
                await s.keys.remove(provider);
                setRevealed(null);
                refresh();
              }}
            />
          </Row>
        </Card>
      ) : (
        <>
          <Text tone="muted">{HELP[provider]}</Text>
          <Button title="Open key page" variant="ghost" onPress={() => void WebBrowser.openBrowserAsync(adapter.keyHelpUrl)} />
          <Input label="API key" value={value} onChangeText={setValue} secureTextEntry autoCapitalize="none" autoCorrect={false} mono />
          <Button title="Validate & save" full loading={busy === 'save'} disabled={!value} onPress={save} />
        </>
      )}
      {msg ? (
        <Text tone={msg.tone} accessibilityLiveRegion="polite">
          {msg.text}
        </Text>
      ) : null}
    </Screen>
  );
}

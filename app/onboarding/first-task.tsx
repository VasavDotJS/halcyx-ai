import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { defaultModel } from '@/core/providers/modelConfig';
import { STARTER_PROMPT } from '@/core/prompts/library';
import type { RepoRef } from '@/core/types';
import { useReadyServices } from '@/hooks/useServices';
import { useSettings } from '@/state/settings';
import { Button, Card, Input, Screen, Text } from '@/ui/primitives';

export default function FirstTask() {
  const s = useReadyServices();
  const update = useSettings((x) => x.update);
  const { repo } = useLocalSearchParams<{ repo: string }>();
  const parsed = JSON.parse(repo ?? '{}') as RepoRef;
  const [prompt, setPrompt] = useState(STARTER_PROMPT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const provider = (await s.keys.has('gemini')) ? 'gemini' : (await s.keys.has('anthropic')) ? 'anthropic' : 'openai';
      const model = defaultModel(s.models(), provider);
      const taskId = await s.runner.start({
        prompt,
        images: [],
        repo: parsed,
        baseBranch: parsed.defaultBranch,
        provider,
        model: model.id,
        effort: model.defaultEffort,
        instructions: '',
      });
      update({ onboarded: true, defaultProvider: provider });
      router.replace(`/(tabs)/chat/${taskId}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen narrow>
      <Text variant="title" accessibilityRole="header">
        Your first task
      </Text>
      <Card>
        <Text variant="label">
          {parsed.owner}/{parsed.name} · {parsed.defaultBranch}
        </Text>
      </Card>
      <Input label="Prompt" value={prompt} onChangeText={setPrompt} multiline className="min-h-[120px]" />
      <Text variant="caption" tone="muted">
        The agent works on a copy in its cloud sandbox. Nothing is pushed until you review it.
      </Text>
      {error ? <Text tone="danger">{error}</Text> : null}
      <Button title="Start agent" full loading={busy} onPress={start} />
      <Button
        title="Skip for now"
        variant="ghost"
        onPress={() => {
          update({ onboarded: true });
          router.replace('/(tabs)/chat');
        }}
      />
    </Screen>
  );
}

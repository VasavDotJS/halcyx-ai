import { useQuery } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { PromptLibrary } from '@/core/prompts/library';
import { SLASH_COMMANDS } from '@/core/prompts/slash';
import { useReadyServices } from '@/hooks/useServices';
import { Button, IconButton, Input, ListRow, Screen, Section, Text } from '@/ui/primitives';

export default function Prompts() {
  const s = useReadyServices();
  const lib = useMemo(() => new PromptLibrary(s.platform), [s]);
  const list = useQuery({ queryKey: ['prompts'], queryFn: () => lib.list() });
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  return (
    <Screen title="Prompt library">
      <Section title="Saved prompts">
        {list.data?.length ? (
          list.data.map((p, i, all) => (
            <ListRow
              key={p.id}
              label={p.title}
              detail={p.body.slice(0, 120)}
              last={i === all.length - 1}
              right={
                <IconButton
                  icon={Trash2}
                  label={`Delete ${p.title}`}
                  tone="danger"
                  onPress={async () => {
                    await lib.remove(p.id);
                    void list.refetch();
                  }}
                />
              }
            />
          ))
        ) : (
          <ListRow label="No saved prompts yet" last />
        )}
      </Section>
      <Input label="Title" value={title} onChangeText={setTitle} />
      <Input label="Prompt" value={body} onChangeText={setBody} multiline className="min-h-[120px]" />
      <Button
        title="Save prompt"
        disabled={!title || !body}
        onPress={async () => {
          await lib.save(title, body);
          setTitle('');
          setBody('');
          void list.refetch();
        }}
      />
      <Section title="Slash commands">
        {SLASH_COMMANDS.map((c, i) => (
          <ListRow key={c.name} label={c.name} detail={c.hint} last={i === SLASH_COMMANDS.length - 1} />
        ))}
      </Section>
      <Text variant="caption" tone="muted">
        Saved prompts are encrypted on this device.
      </Text>
    </Screen>
  );
}

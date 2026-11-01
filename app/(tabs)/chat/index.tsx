import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { BookMarked, ChevronDown, GitBranch, History, Users } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { BudgetExceededError } from '@/core/agent/runner';
import { listBranches } from '@/core/github/repos';
import { defaultModel, findModel } from '@/core/providers/modelConfig';
import { PromptLibrary, PROJECT_TEMPLATES, RepoSettingsStore } from '@/core/prompts/library';
import { expandSlash } from '@/core/prompts/slash';
import type { Effort, ProviderId, RepoRef } from '@/core/types';
import { isOnline } from '@/hooks/useAppLifecycle';
import { useKeys } from '@/hooks/useKeys';
import { useReadyServices } from '@/hooks/useServices';
import { useSettings } from '@/state/settings';
import { Composer, type ComposerSubmit } from '@/ui/Composer';
import { Logo } from '@/ui/Logo';
import { type ModelChoice, ModelPicker } from '@/ui/ModelControls';
import { Button, EmptyState, IconButton, ListRow, Screen, Sheet, Text } from '@/ui/primitives';
import { RepoList } from '@/ui/RepoList';
import { TaskRow } from '@/ui/TaskList';
import { useTheme } from '@/ui/ThemeProvider';

export default function NewTask() {
  const s = useReadyServices();
  const t = useTheme();
  const qc = useQueryClient();
  const keys = useKeys();
  const settings = useSettings();
  const repo = settings.lastRepo;
  const branch = settings.lastBranch ?? repo?.defaultBranch ?? 'main';
  const [repoOpen, setRepoOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const cfg = s.models();
  const library = useMemo(() => new PromptLibrary(s.platform), [s]);
  const repoSettings = useMemo(() => new RepoSettingsStore(s.platform), [s]);

  const initial = useMemo<ModelChoice>(() => {
    const provider = settings.defaultProvider;
    const m = findModel(cfg, provider, settings.defaultModel[provider] ?? '') ?? defaultModel(cfg, provider);
    return { provider, model: m.id, effort: m.efforts.includes(settings.defaultEffort) ? settings.defaultEffort : m.defaultEffort };
  }, [cfg, settings.defaultProvider, settings.defaultModel, settings.defaultEffort]);
  const [choice, setChoice] = useState<ModelChoice>(initial);
  const [variants, setVariants] = useState<ModelChoice[]>([]);

  const recent = useQuery({ queryKey: ['tasks'], queryFn: () => s.tasks.list(8), refetchInterval: 5_000 });
  const branches = useQuery({
    queryKey: ['branches', repo?.owner, repo?.name],
    enabled: !!repo && branchOpen,
    queryFn: async () => listBranches(await s.github(), `${repo!.owner}/${repo!.name}`),
  });
  const prompts = useQuery({ queryKey: ['prompts'], queryFn: () => library.list(), enabled: libraryOpen });

  const selectRepo = async (r: RepoRef) => {
    settings.update({ lastRepo: r, lastBranch: r.defaultBranch });
    setRepoOpen(false);
    const rs = await repoSettings.get(`${r.owner}/${r.name}`);
    if (rs.provider && rs.model) {
      const m = findModel(cfg, rs.provider as ProviderId, rs.model);
      if (m) setChoice({ provider: rs.provider as ProviderId, model: m.id, effort: (rs.effort as Effort) ?? m.defaultEffort });
    }
  };

  const submit = async ({ text, images }: ComposerSubmit) => {
    setError(null);
    setNotice(null);
    if (!repo) {
      setRepoOpen(true);
      return;
    }
    const repoFull = `${repo.owner}/${repo.name}`;
    const rs = await repoSettings.get(repoFull);
    const base = { prompt: expandSlash(text), images, repo, baseBranch: branch, instructions: rs.instructions };
    try {
      if (!(await isOnline())) {
        await s.queue.enqueue('prompt', { ...base, ...choice });
        setNotice('You’re offline — the task is queued and will start automatically.');
        return;
      }
      await repoSettings.rememberModel(repoFull, choice.provider, choice.model, choice.effort);
      if (variants.length >= 2) {
        const { groupId } = await s.runner.startGroup(base, variants);
        setVariants([]);
        router.push(`/compare/${groupId}`);
      } else {
        const id = await s.runner.start({ ...base, ...choice });
        router.push(`/(tabs)/chat/${id}`);
      }
      void qc.invalidateQueries({ queryKey: ['tasks'] });
    } catch (e) {
      setError(e instanceof BudgetExceededError ? e.message : (e as Error).message);
    }
  };

  return (
    <Screen edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View className="flex-row items-center justify-between pt-2">
        <Logo height={20} />
        <View className="flex-row">
          <IconButton icon={BookMarked} label="Prompt library and templates" onPress={() => setLibraryOpen(true)} />
          <IconButton icon={History} label="Task history" onPress={() => router.push('/(tabs)/settings/history')} />
        </View>
      </View>

      <View className="gap-3 pt-8">
        <Text variant="title" accessibilityRole="header">
          What should the agent build?
        </Text>
        <View className="flex-row flex-wrap items-center gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={repo ? `Repository ${repo.owner}/${repo.name}. Change` : 'Choose repository'}
            onPress={() => setRepoOpen(true)}
            className="min-h-[36px] flex-row items-center gap-1.5 rounded-full border-hairline border-hairline px-3"
          >
            <Text variant="label">{repo ? `${repo.owner}/${repo.name}` : 'Choose repository'}</Text>
            <ChevronDown size={14} color={t.colors.muted} />
          </Pressable>
          {repo ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Branch ${branch}. Change`}
              onPress={() => setBranchOpen(true)}
              className="min-h-[36px] flex-row items-center gap-1.5 rounded-full border-hairline border-hairline px-3"
            >
              <GitBranch size={14} color={t.colors.muted} />
              <Text variant="label">{branch}</Text>
            </Pressable>
          ) : null}
          <ModelPicker config={cfg} value={choice} onChange={setChoice} hasKey={keys.has} onAddKey={(p) => router.push(`/keys/${p}`)} />
          <IconButton
            icon={Users}
            label="Run several agents and compare"
            active={variants.length > 0}
            onPress={() => setCompareOpen(true)}
          />
        </View>
        <Composer
          placeholder="Describe a task… (try /fix, /test, /explain, /pr)"
          onSubmit={submit}
          footer={
            <>
              {variants.length >= 2 ? (
                <Text variant="caption" tone="accent">
                  Comparing {variants.length} agents on separate branches.
                </Text>
              ) : null}
              {error ? <Text tone="danger">{error}</Text> : null}
              {notice ? <Text tone="warning">{notice}</Text> : null}
            </>
          }
        />
      </View>

      <View className="gap-1 pt-6">
        <Text variant="caption" tone="muted" className="uppercase tracking-widest">
          Recent
        </Text>
        {recent.data?.length ? (
          recent.data.map((task) => <TaskRow key={task.id} task={task} />)
        ) : (
          <EmptyState title="No tasks yet" body="Pick a repo, describe a change, and the agent gets to work in its cloud sandbox." />
        )}
      </View>

      <Sheet visible={repoOpen} title="Repository" onClose={() => setRepoOpen(false)}>
        <View className="h-[480px]">
          <RepoList onSelect={selectRepo} />
        </View>
      </Sheet>

      <Sheet visible={branchOpen} title="Base branch" onClose={() => setBranchOpen(false)}>
        <View className="overflow-hidden rounded-md border-hairline border-hairline">
          {(branches.data ?? []).map((b, i, all) => (
            <ListRow
              key={b.name}
              label={b.name}
              detail={b.sha.slice(0, 7)}
              last={i === all.length - 1}
              onPress={() => {
                settings.update({ lastBranch: b.name });
                setBranchOpen(false);
              }}
            />
          ))}
        </View>
      </Sheet>

      <Sheet visible={libraryOpen} title="Prompts & templates" onClose={() => setLibraryOpen(false)}>
        <Text variant="caption" tone="muted" className="uppercase tracking-widest">
          Templates
        </Text>
        <View className="overflow-hidden rounded-md border-hairline border-hairline">
          {PROJECT_TEMPLATES.map((tpl, i) => (
            <ListRow
              key={tpl.id}
              label={tpl.title}
              detail={tpl.stack}
              last={i === PROJECT_TEMPLATES.length - 1}
              onPress={() => {
                setLibraryOpen(false);
                void submit({ text: tpl.prompt, images: [] });
              }}
            />
          ))}
        </View>
        <Text variant="caption" tone="muted" className="uppercase tracking-widest">
          Saved prompts
        </Text>
        {prompts.data?.length ? (
          <View className="overflow-hidden rounded-md border-hairline border-hairline">
            {prompts.data.map((p, i) => (
              <ListRow
                key={p.id}
                label={p.title}
                detail={p.body.slice(0, 80)}
                last={i === prompts.data.length - 1}
                onPress={() => {
                  setLibraryOpen(false);
                  void submit({ text: p.body, images: [] });
                }}
              />
            ))}
          </View>
        ) : (
          <Text tone="muted">Save prompts from Settings › Prompt library.</Text>
        )}
      </Sheet>

      <Sheet visible={compareOpen} title="Compare agents" onClose={() => setCompareOpen(false)}>
        <Text tone="muted">Run the same task with 2–3 agents on separate branches, then keep the best result.</Text>
        {variants.map((v, i) => (
          <View key={i} className="flex-row items-center gap-2">
            <ModelPicker
              config={cfg}
              value={v}
              onChange={(nv) => setVariants((all) => all.map((x, j) => (j === i ? nv : x)))}
              hasKey={keys.has}
              onAddKey={(p) => router.push(`/keys/${p}`)}
            />
            <Button title="Remove" size="sm" variant="ghost" onPress={() => setVariants((all) => all.filter((_, j) => j !== i))} />
          </View>
        ))}
        {variants.length < 3 ? (
          <Button title="Add agent" variant="secondary" onPress={() => setVariants((all) => [...all, choice])} />
        ) : null}
        <Button title={variants.length >= 2 ? 'Done' : 'Single agent'} onPress={() => setCompareOpen(false)} />
      </Sheet>
    </Screen>
  );
}

import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { CircleCheck, CircleDot, CircleX, GitBranchPlus, GitMerge, Play } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { checksFor, type CheckState } from '@/core/github/checks';
import { listOpenPulls, mergePullRequest } from '@/core/github/pulls';
import { branchHead, createBranch, listBranches, recentCommits } from '@/core/github/repos';
import { RepoSettingsStore } from '@/core/prompts/library';
import type { RepoRef } from '@/core/types';
import { useReadyServices } from '@/hooks/useServices';
import { useSettings } from '@/state/settings';
import { Badge, Button, Input, ListRow, Row, Screen, Section, Segmented, Text } from '@/ui/primitives';
import { useTheme } from '@/ui/ThemeProvider';

function CheckIcon({ state }: { state: CheckState }) {
  const t = useTheme();
  if (state === 'success') return <CircleCheck size={16} color={t.colors.success} accessibilityLabel="Checks passed" />;
  if (state === 'failure') return <CircleX size={16} color={t.colors.danger} accessibilityLabel="Checks failed" />;
  return <CircleDot size={16} color={t.colors.muted} accessibilityLabel="Checks pending" />;
}

export default function RepoDetail() {
  const params = useLocalSearchParams<{ owner: string; repo: string; meta: string }>();
  const repo = JSON.parse(params.meta ?? '{}') as RepoRef;
  const full = `${params.owner}/${params.repo}`;
  const s = useReadyServices();
  const update = useSettings((x) => x.update);
  const store = useMemo(() => new RepoSettingsStore(s.platform), [s]);
  const [tab, setTab] = useState<'branches' | 'pulls' | 'commits' | 'agent'>('pulls');
  const [branch, setBranch] = useState(repo.defaultBranch);
  const [newBranch, setNewBranch] = useState('');
  const [instructions, setInstructions] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const branches = useQuery({ queryKey: ['branches', full], queryFn: async () => listBranches(await s.github(), full) });
  const pulls = useQuery({
    queryKey: ['pulls', full],
    queryFn: async () => {
      const gh = await s.github();
      const list = await listOpenPulls(gh, full);
      return Promise.all(
        list.map(async (p) => ({ ...p, checks: (await checksFor(gh, full, p.head).catch(() => null))?.overall ?? 'neutral' })),
      );
    },
  });
  const commits = useQuery({ queryKey: ['commits', full, branch], queryFn: async () => recentCommits(await s.github(), full, branch) });
  const ci = useQuery({ queryKey: ['ci', full, branch], queryFn: async () => checksFor(await s.github(), full, branch) });
  const settings = useQuery({ queryKey: ['repo-settings', full], queryFn: () => store.get(full) });

  return (
    <Screen title={params.repo}>
      <Row className="flex-wrap">
        <Text variant="heading" className="flex-1">
          {full}
        </Text>
        {ci.data ? <CheckIcon state={ci.data.overall} /> : null}
        {repo.private ? <Badge label="private" /> : null}
      </Row>
      <Button
        title={`New task on ${branch}`}
        icon={Play}
        onPress={() => {
          update({ lastRepo: repo, lastBranch: branch });
          router.push('/(tabs)/chat');
        }}
      />
      <Segmented
        label="Repository section"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'pulls', label: 'PRs' },
          { value: 'branches', label: 'Branches' },
          { value: 'commits', label: 'Commits' },
          { value: 'agent', label: 'Agent' },
        ]}
      />
      {msg ? <Text tone="muted">{msg}</Text> : null}

      {tab === 'pulls' ? (
        <Section title="Open pull requests">
          {(pulls.data ?? []).length ? (
            pulls.data!.map((p, i, all) => (
              <ListRow
                key={p.number}
                label={`#${p.number} ${p.title}`}
                detail={`${p.head}${p.draft ? ' · draft' : ''}`}
                last={i === all.length - 1}
                right={
                  <Row>
                    <CheckIcon state={p.checks} />
                    <Button
                      title="Merge"
                      size="sm"
                      variant="secondary"
                      icon={GitMerge}
                      disabled={p.checks === 'failure' || p.draft}
                      onPress={async () => {
                        try {
                          await mergePullRequest(await s.github(), full, p.number, 'squash');
                          setMsg(`Merged #${p.number}.`);
                          void pulls.refetch();
                        } catch (e) {
                          setMsg((e as Error).message);
                        }
                      }}
                    />
                  </Row>
                }
                onPress={() => void WebBrowser.openBrowserAsync(p.url)}
              />
            ))
          ) : (
            <ListRow label="No open pull requests" last />
          )}
        </Section>
      ) : null}

      {tab === 'branches' ? (
        <>
          <Section title="Branches">
            {(branches.data ?? []).map((b, i, all) => (
              <ListRow
                key={b.name}
                label={b.name}
                detail={b.sha.slice(0, 7)}
                last={i === all.length - 1}
                right={b.name === branch ? <Badge label="selected" tone="accent" /> : undefined}
                onPress={() => setBranch(b.name)}
              />
            ))}
          </Section>
          <Input label={`Create branch from ${branch}`} value={newBranch} onChangeText={setNewBranch} autoCapitalize="none" mono />
          <Button
            title="Create branch"
            variant="secondary"
            icon={GitBranchPlus}
            disabled={!/^[A-Za-z0-9._/-]+$/.test(newBranch)}
            onPress={async () => {
              try {
                const gh = await s.github();
                const sha = await branchHead(gh, full, branch);
                if (!sha) throw new Error('Base branch not found');
                await createBranch(gh, full, newBranch, sha);
                setMsg(`Created ${newBranch}.`);
                setNewBranch('');
                void branches.refetch();
              } catch (e) {
                setMsg((e as Error).message);
              }
            }}
          />
        </>
      ) : null}

      {tab === 'commits' ? (
        <Section title={`Recent commits on ${branch}`}>
          {(commits.data ?? []).map((c, i, all) => (
            <ListRow key={c.sha} label={c.message} detail={`${c.sha.slice(0, 7)} · ${c.author}`} last={i === all.length - 1} />
          ))}
        </Section>
      ) : null}

      {tab === 'agent' ? (
        <View className="gap-3">
          <Text tone="muted">
            Instructions the agent always reads for this repository (like an AGENTS.md). Stored encrypted on this device and sent only to
            the provider you run.
          </Text>
          <Input
            label="Repository instructions"
            value={instructions ?? settings.data?.instructions ?? ''}
            onChangeText={setInstructions}
            multiline
            className="min-h-[160px]"
            placeholder="e.g. Use pnpm. Run `pnpm test` before finishing. Follow the existing ESLint config."
          />
          <Button
            title="Save instructions"
            disabled={instructions === null}
            onPress={async () => {
              await store.setInstructions(full, instructions ?? '');
              setInstructions(null);
              void settings.refetch();
              setMsg('Saved.');
            }}
          />
          {settings.data?.model ? (
            <Text variant="caption" tone="muted">
              Last used: {settings.data.model} · {settings.data.effort}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}

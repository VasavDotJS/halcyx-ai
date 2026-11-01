import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { CircleCheck, CircleX, GitBranch, GitMerge, RefreshCw, ShieldAlert, Trash2, Upload } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Alert, Platform, useWindowDimensions, View } from 'react-native';
import { readFileAt } from '@/core/github/repos';
import { authenticate } from '@/core/security/biometrics';
import { utf8 } from '@/core/security/crypto';
import { computeHunks, diffStats } from '@/core/workspace/diff';
import { preflight, type Preflight } from '@/core/workspace/preflight';
import type { PushOutcome } from '@/core/workspace/pushFlow';
import { isOnline } from '@/hooks/useAppLifecycle';
import { useReadyServices } from '@/hooks/useServices';
import { formatBytes } from '@/core/cleaner/patterns';
import { Countdown } from './Countdown';
import { DiffView } from './DiffView';
import { FileTree } from './FileTree';
import { haptic } from './haptics';
import { MessageText } from './MessageText';
import { Badge, Button, Card, Input, Row, Segmented, Sheet, Text, Toggle } from './primitives';
import { useTheme } from './ThemeProvider';

function confirm(title: string, body: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(globalThis.confirm?.(`${title}\n\n${body}`) ?? false);
  return new Promise((resolve) =>
    Alert.alert(title, body, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Continue', style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}

/** Review → push → erase. Shared by the Review tab and the tablet split view. */
export function ReviewPanel({ workspaceId, onDone }: { workspaceId: string; onDone?: (o: PushOutcome | 'discarded') => void }) {
  const s = useReadyServices();
  const t = useTheme();
  const qc = useQueryClient();
  const { width } = useWindowDimensions();
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<'unified' | 'split'>(width >= 900 ? 'split' : 'unified');
  const [message, setMessage] = useState<string | null>(null);
  const [toBase, setToBase] = useState(false);
  const [openPr, setOpenPr] = useState(true);
  const [check, setCheck] = useState<Preflight | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PushOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ws = useQuery({ queryKey: ['workspace', workspaceId], queryFn: () => s.workspaces.get(workspaceId), retry: false });
  const files = useQuery({
    queryKey: ['workspace-files', workspaceId],
    queryFn: () => s.workspaces.files(workspaceId),
    enabled: !!ws.data,
  });
  const current = files.data?.find((f) => f.id === (selected ?? files.data?.[0]?.id)) ?? null;

  const fetchBase = async (path: string) => readFileAt(await s.github(), ws.data!.repoFull, ws.data!.meta.baseSha, path);

  const diff = useQuery({
    queryKey: ['diff', workspaceId, current?.id],
    enabled: !!current && !!ws.data,
    queryFn: async () => {
      const f = current!;
      if (f.binary) return { hunks: [], binary: true };
      const head = f.change === 'deleted' ? '' : utf8.decode((await s.workspaces.readHead(workspaceId, f.id)) ?? new Uint8Array());
      const base = f.change === 'added' ? '' : utf8.decode(await s.workspaces.readBase(workspaceId, f.id, () => fetchBase(f.path)));
      return { hunks: computeHunks(base, head), binary: false };
    },
  });

  const stats = useMemo(() => (current && diff.data ? { [current.id]: diffStats(diff.data.hunks) } : {}), [current, diff.data]);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['workspace-files', workspaceId] });
    void qc.invalidateQueries({ queryKey: ['workspaces'] });
  };

  if (ws.error) return <Text tone="muted">This workspace was pushed, expired or discarded. Only metadata remains in history.</Text>;
  if (!ws.data || !files.data) return null;
  const w = ws.data;
  const commitMessage = message ?? w.meta.commitMessage;
  const rejected = new Set(current?.rejectedHunks ?? []);

  const runPreflight = async () => {
    setBusy('check');
    setError(null);
    try {
      const final = await s.workspaces.finalFiles(workspaceId, fetchBase);
      setCheck(preflight(final, w.meta.checks));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const push = async (overrideSecrets: boolean) => {
    if (overrideSecrets && !(await authenticate('Confirm pushing despite possible secrets'))) return;
    setBusy('push');
    setError(null);
    try {
      if (toBase) await s.workspaces.updateMeta(workspaceId, { targetBranch: w.meta.baseBranch });
      const opts = {
        overrideSecrets,
        openPullRequest: openPr && !toBase,
        createBranch: !toBase,
        commitMessage: commitMessage.trim() || 'chore: changes from HALCYX',
        taskTitle: w.meta.summary.split('\n')[0] ?? 'HALCYX task',
      };
      if (!(await isOnline())) {
        await s.queue.enqueue('push', { workspaceId, opts });
        setCheck(null);
        setError('You’re offline — the push is queued and will run when you reconnect.');
        return;
      }
      const out = await s.runner.push(workspaceId, opts);
      setCheck(null);
      if (out.kind === 'blocked') {
        setCheck(out.preflight);
        return;
      }
      haptic.success();
      setOutcome(out);
      refresh();
      onDone?.(out);
    } catch (e) {
      haptic.warning();
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (outcome?.kind === 'pushed') {
    return (
      <Card className="gap-3 border-success">
        <Row>
          <CircleCheck size={22} color={t.colors.success} />
          <Text variant="heading">Pushed to {outcome.branch}</Text>
        </Row>
        <Text variant="mono">{outcome.commitSha.slice(0, 12)}</Text>
        <Text tone="muted">The local copy was erased and its encryption key destroyed. Only metadata remains in history.</Text>
        {outcome.prUrl ? (
          <Button title="Open pull request" icon={GitMerge} onPress={() => void WebBrowser.openBrowserAsync(outcome.prUrl!)} />
        ) : null}
      </Card>
    );
  }

  return (
    <View className="gap-4">
      <Row className="flex-wrap">
        <Text variant="heading" className="flex-1">
          {w.repoFull}
        </Text>
        <Countdown expiresAt={w.expiresAt} />
      </Row>

      {w.status === 'needs_rebase' || outcome?.kind === 'remote_moved' ? (
        <Card className="gap-2 border-warning">
          <Row>
            <RefreshCw size={18} color={t.colors.warning} />
            <Text variant="label">{w.meta.baseBranch} moved since the agent started.</Text>
          </Row>
          <Text tone="muted">
            Let the agent rebase onto the latest commit and resolve conflicts. You’ll review the new diff before pushing.
          </Text>
          <Button
            title="Rebase with agent"
            loading={busy === 'rebase'}
            onPress={async () => {
              setBusy('rebase');
              await s.runner.rebase(workspaceId).catch((e: Error) => setError(e.message));
              setBusy(null);
              refresh();
            }}
          />
        </Card>
      ) : null}

      {w.meta.summary ? (
        <Card className="gap-2">
          <Text variant="caption" tone="muted" className="uppercase tracking-widest">
            Summary
          </Text>
          <MessageText text={w.meta.summary} />
        </Card>
      ) : null}

      <Row className="flex-wrap">
        <Badge
          label={`Lint: ${w.meta.checks.lint.status.replace('_', ' ')}`}
          tone={w.meta.checks.lint.status === 'passed' ? 'success' : w.meta.checks.lint.status === 'failed' ? 'danger' : 'muted'}
        />
        <Badge
          label={`Tests: ${w.meta.checks.tests.status.replace('_', ' ')}`}
          tone={w.meta.checks.tests.status === 'passed' ? 'success' : w.meta.checks.tests.status === 'failed' ? 'danger' : 'muted'}
        />
        <Badge label={`${files.data.length} files`} />
      </Row>

      <View className={width >= 900 ? 'flex-row gap-4' : 'gap-4'}>
        <View className={width >= 900 ? 'w-[260px]' : ''}>
          <FileTree files={files.data} selectedId={current?.id ?? null} onSelect={setSelected} stats={stats} />
        </View>
        <View className="flex-1 gap-3">
          {current ? (
            <>
              <Row className="flex-wrap">
                <Text variant="mono" className="flex-1" numberOfLines={2}>
                  {current.path}
                </Text>
                <Button
                  size="sm"
                  variant={current.decision === 'rejected' ? 'secondary' : 'ghost'}
                  icon={current.decision === 'rejected' ? CircleX : CircleCheck}
                  title={current.decision === 'rejected' ? 'File rejected' : 'File accepted'}
                  onPress={async () => {
                    await s.workspaces.setDecision(
                      workspaceId,
                      current.id,
                      current.decision === 'rejected' ? 'accepted' : 'rejected',
                      current.rejectedHunks,
                    );
                    refresh();
                  }}
                />
              </Row>
              <Segmented
                label="Diff layout"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'unified', label: 'Unified' },
                  { value: 'split', label: 'Split' },
                ]}
              />
              {diff.data?.binary ? (
                <Text tone="muted">Binary file · {formatBytes(current.size)}</Text>
              ) : diff.data ? (
                <DiffView
                  hunks={diff.data.hunks}
                  mode={mode}
                  rejected={rejected}
                  onToggleHunk={
                    current.change === 'modified'
                      ? async (i) => {
                          const next = rejected.has(i) ? [...rejected].filter((x) => x !== i) : [...rejected, i];
                          await s.workspaces.setDecision(workspaceId, current.id, current.decision, next);
                          refresh();
                        }
                      : undefined
                  }
                />
              ) : (
                <Text tone="muted">Loading diff…</Text>
              )}
            </>
          ) : (
            <Text tone="muted">No changes.</Text>
          )}
        </View>
      </View>

      <Card className="gap-3">
        <Input label="Commit message" value={commitMessage} onChangeText={setMessage} multiline mono />
        <Segmented
          label="Push target"
          value={toBase ? 'base' : 'new'}
          onChange={(v) => setToBase(v === 'base')}
          options={[
            { value: 'new', label: w.meta.targetBranch.startsWith('halcyx/') ? w.meta.targetBranch : 'New branch' },
            { value: 'base', label: w.meta.baseBranch },
          ]}
        />
        {!toBase ? (
          <View className="overflow-hidden rounded-md border-hairline border-hairline">
            <Toggle label="Open as pull request" value={openPr} onChange={setOpenPr} last />
          </View>
        ) : (
          <Row>
            <GitBranch size={14} color={t.colors.warning} />
            <Text variant="caption" tone="warning" className="flex-1">
              Fast-forwards {w.meta.baseBranch}. Never force-pushes; stops if the branch moved.
            </Text>
          </Row>
        )}
        {error ? (
          <Text tone="danger" accessibilityLiveRegion="assertive">
            {error}
          </Text>
        ) : null}
        <Button title="Check & push" icon={Upload} full loading={busy === 'check'} onPress={runPreflight} />
        <Button
          title="Discard changes"
          variant="ghost"
          icon={Trash2}
          onPress={async () => {
            if (!(await confirm('Discard these changes?', 'They will be erased from this device and the remote sandbox.'))) return;
            await s.runner.discard(workspaceId);
            refresh();
            onDone?.('discarded');
          }}
        />
      </Card>

      <Sheet visible={!!check} title="Pre-push checks" onClose={() => setCheck(null)}>
        {check ? (
          <>
            {check.secrets.length ? (
              <Card className="gap-2 border-danger">
                <Row>
                  <ShieldAlert size={18} color={t.colors.danger} />
                  <Text variant="label" tone="danger">
                    {check.secrets.length} possible secret{check.secrets.length > 1 ? 's' : ''} — push blocked
                  </Text>
                </Row>
                {check.secrets.slice(0, 12).map((f, i) => (
                  <Text key={i} variant="monoSmall">
                    {f.path}
                    {f.line ? `:${f.line}` : ''} · {f.description} · {f.preview}
                  </Text>
                ))}
              </Card>
            ) : (
              <Row>
                <CircleCheck size={18} color={t.colors.success} />
                <Text>No secrets detected</Text>
              </Row>
            )}
            {check.largeFiles.map((f) => (
              <Text key={f.path} tone={f.blocking ? 'danger' : 'warning'}>
                {f.blocking ? 'Too large for GitHub' : 'Large file'}: {f.path} ({formatBytes(f.bytes)})
              </Text>
            ))}
            <Text tone="muted">
              Sandbox lint: {check.checks.lint.status.replace('_', ' ')} · tests: {check.checks.tests.status.replace('_', ' ')}
            </Text>
            {check.blocked && !check.secrets.length ? <Text tone="danger">{check.blockReasons.join(' · ')}</Text> : null}
            {!check.blocked ? (
              <Button
                title={toBase ? `Push to ${w.meta.baseBranch}` : `Push ${openPr ? '& open PR' : ''}`}
                icon={Upload}
                full
                loading={busy === 'push'}
                onPress={() => push(false)}
              />
            ) : check.secrets.length && check.blockReasons.length === 1 ? (
              <Button title="Push anyway (I’ve checked these)" variant="danger" full loading={busy === 'push'} onPress={() => push(true)} />
            ) : null}
          </>
        ) : null}
      </Sheet>
    </View>
  );
}

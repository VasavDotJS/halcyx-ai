import {
  Brain,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  FileCode,
  FlaskConical,
  ListTodo,
  LoaderCircle,
  Search,
  ShieldQuestion,
  SquareTerminal,
  Wrench,
} from 'lucide-react-native';
import { MotiView, type MotiTransitionProp } from 'moti';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import type { PendingApproval, Timeline as TimelineData, TimelineStep } from '@/core/agent/timeline';
import type { StepKind } from '@/core/types';
import { MessageText } from './MessageText';
import { Button } from './primitives/Button';
import { Text } from './primitives/Text';
import { useMotion, useTheme } from './ThemeProvider';

const ICON: Record<StepKind, typeof Wrench> = {
  plan: ListTodo,
  command: SquareTerminal,
  file: FileCode,
  search: Search,
  tool: Wrench,
  test: FlaskConical,
};

function Step({ step }: { step: TimelineStep }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const Icon = ICON[step.kind];
  const StateIcon = step.state === 'started' ? LoaderCircle : step.state === 'error' ? CircleAlert : CircleCheck;
  const stateColor = step.state === 'error' ? t.colors.danger : step.state === 'done' ? t.colors.success : t.colors.muted;
  const duration = useMotion('fast');
  return (
    <MotiView
      from={{ opacity: 0, translateY: 4 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration } as MotiTransitionProp}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${step.title}, ${step.state === 'started' ? 'running' : step.state}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        disabled={!step.output}
        className="min-h-[40px] flex-row items-center gap-2 px-1"
      >
        <Icon size={15} color={t.colors.muted} strokeWidth={1.75} />
        <Text variant={step.kind === 'command' ? 'mono' : 'label'} numberOfLines={1} className="flex-1">
          {step.title}
        </Text>
        <StateIcon size={15} color={stateColor} strokeWidth={1.75} />
        {step.output ? open ? <ChevronDown size={15} color={t.colors.muted} /> : <ChevronRight size={15} color={t.colors.muted} /> : null}
      </Pressable>
      {open && step.output ? (
        <ScrollView horizontal className="mb-2 ml-6 rounded-sm border-hairline border-hairline bg-bg">
          <Text variant="monoSmall" selectable className="p-2">
            {step.output}
          </Text>
        </ScrollView>
      ) : null}
    </MotiView>
  );
}

export function ApprovalCard({ approval, onAnswer }: { approval: PendingApproval; onAnswer: (allow: boolean) => void }) {
  const t = useTheme();
  return (
    <View accessibilityRole="alert" className="gap-3 rounded-lg border-hairline border-warning bg-surface p-4">
      <View className="flex-row items-center gap-2">
        <ShieldQuestion size={18} color={t.colors.warning} />
        <Text variant="heading" className="flex-1">
          {approval.title}
        </Text>
      </View>
      {approval.detail ? (
        <Text variant="mono" selectable className="rounded-sm bg-bg p-2">
          {approval.detail}
        </Text>
      ) : null}
      <View className="flex-row gap-2">
        <Button title="Deny" variant="secondary" className="flex-1" onPress={() => onAnswer(false)} />
        <Button title="Approve" className="flex-1" onPress={() => onAnswer(true)} />
      </View>
    </View>
  );
}

/** Collapsible live activity timeline: thinking, steps with terminal output, streamed text. */
export function Timeline({ data, onApprove }: { data: TimelineData; onApprove: (id: string, allow: boolean) => void }) {
  const t = useTheme();
  const [showThinking, setShowThinking] = useState(false);
  const [showSteps, setShowSteps] = useState(true);
  return (
    <View className="gap-3">
      {data.thinking ? (
        <View className="rounded-md border-hairline border-hairline">
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showThinking }}
            onPress={() => setShowThinking((v) => !v)}
            className="min-h-[40px] flex-row items-center gap-2 px-3"
          >
            <Brain size={15} color={t.colors.muted} />
            <Text variant="label" tone="muted" className="flex-1">
              Thinking
            </Text>
            {showThinking ? <ChevronDown size={15} color={t.colors.muted} /> : <ChevronRight size={15} color={t.colors.muted} />}
          </Pressable>
          {showThinking ? (
            <Text tone="muted" className="px-3 pb-3">
              {data.thinking}
            </Text>
          ) : null}
        </View>
      ) : null}

      {data.steps.length ? (
        <View className="rounded-md border-hairline border-hairline px-2 py-1">
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showSteps }}
            onPress={() => setShowSteps((v) => !v)}
            className="min-h-[36px] flex-row items-center gap-2 px-1"
          >
            <Text variant="caption" tone="muted" className="flex-1 uppercase tracking-widest">
              Activity · {data.steps.length} steps
            </Text>
            {showSteps ? <ChevronDown size={15} color={t.colors.muted} /> : <ChevronRight size={15} color={t.colors.muted} />}
          </Pressable>
          {showSteps ? data.steps.map((s) => <Step key={s.id} step={s} />) : null}
        </View>
      ) : null}

      {data.approvals.map((a) => (
        <ApprovalCard key={a.approvalId} approval={a} onAnswer={(allow) => onApprove(a.approvalId, allow)} />
      ))}

      {data.text ? <MessageText text={data.text} /> : null}

      {data.errors.map((e, i) => (
        <Text key={i} tone="danger" accessibilityLiveRegion="assertive">
          {e}
        </Text>
      ))}
    </View>
  );
}

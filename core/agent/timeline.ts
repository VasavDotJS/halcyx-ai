import type { AgentEvent, StepKind, TaskStatus } from '@/core/types';

export type TimelineStep = {
  id: string;
  kind: StepKind;
  title: string;
  state: 'started' | 'done' | 'error';
  output: string;
};

export type PendingApproval = { approvalId: string; title: string; detail: string };

export type Timeline = {
  status: TaskStatus;
  statusDetail: string | null;
  text: string;
  thinking: string;
  steps: TimelineStep[];
  files: Map<string, 'added' | 'modified' | 'deleted'>;
  approvals: PendingApproval[];
  previewUrl: string | null;
  inputTokens: number;
  outputTokens: number;
  errors: string[];
};

const MAX_OUTPUT = 20_000;

export function emptyTimeline(): Timeline {
  return {
    status: 'queued',
    statusDetail: null,
    text: '',
    thinking: '',
    steps: [],
    files: new Map(),
    approvals: [],
    previewUrl: null,
    inputTokens: 0,
    outputTokens: 0,
    errors: [],
  };
}

/** Pure reducer: folds agent events into the activity timeline shown in the chat screen. */
export function reduceTimeline(t: Timeline, e: AgentEvent): Timeline {
  switch (e.type) {
    case 'status':
      return {
        ...t,
        status: e.status,
        statusDetail: e.detail ?? null,
        approvals: e.status === 'awaiting_approval' ? t.approvals : [],
      };
    case 'text':
      return { ...t, text: t.text + e.delta };
    case 'thinking':
      return { ...t, thinking: t.thinking + e.delta };
    case 'step': {
      const idx = t.steps.findIndex((s) => s.id === e.id);
      if (idx < 0) return { ...t, steps: [...t.steps, { id: e.id, kind: e.kind, title: e.title, state: e.state, output: '' }] };
      const steps = t.steps.slice();
      const prev = steps[idx]!;
      steps[idx] = { ...prev, state: e.state, title: prev.title || e.title };
      return { ...t, steps };
    }
    case 'terminal': {
      const idx = t.steps.findIndex((s) => s.id === e.stepId);
      if (idx < 0) return t;
      const steps = t.steps.slice();
      const prev = steps[idx]!;
      steps[idx] = { ...prev, output: (prev.output + e.chunk).slice(-MAX_OUTPUT) };
      return { ...t, steps };
    }
    case 'file_change': {
      const files = new Map(t.files);
      files.set(e.path, e.change);
      return { ...t, files };
    }
    case 'approval':
      if (t.approvals.some((a) => a.approvalId === e.approvalId)) return t;
      return { ...t, approvals: [...t.approvals, { approvalId: e.approvalId, title: e.title, detail: e.detail }] };
    case 'usage':
      return { ...t, inputTokens: t.inputTokens + e.inputTokens, outputTokens: t.outputTokens + e.outputTokens };
    case 'preview_url':
      return { ...t, previewUrl: e.url };
    case 'error':
      return { ...t, errors: [...t.errors, e.message] };
    case 'meta':
      return t;
  }
}

export function buildTimeline(events: AgentEvent[]): Timeline {
  return events.reduce(reduceTimeline, emptyTimeline());
}

export const TERMINAL: TaskStatus[] = ['completed', 'failed', 'cancelled', 'incomplete'];

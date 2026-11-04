import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { buildTimeline, emptyTimeline, reduceTimeline, type Timeline } from '@/core/agent/timeline';
import type { TaskRecord } from '@/core/agent/taskStore';
import type { TaskStatus } from '@/core/types';
import { useReadyServices } from './useServices';

const LIVE: TaskStatus[] = ['queued', 'running', 'awaiting_approval'];

/** Persisted events + live runner events folded into the activity timeline. */
export function useTaskStream(taskId: string): { timeline: Timeline; task: TaskRecord | null; refresh: () => void } {
  const s = useReadyServices();
  const qc = useQueryClient();
  const [timeline, setTimeline] = useState<Timeline>(emptyTimeline);

  // Poll only while the task can still change; status events from the runner refresh it immediately.
  const task = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => s.tasks.get(taskId),
    refetchInterval: (q) => (q.state.data && LIVE.includes(q.state.data.status) ? 5_000 : false),
  });

  useEffect(() => {
    let cancelled = false;
    let loaded = false;
    const pending: Parameters<typeof reduceTimeline>[1][] = [];
    const unsubscribe = s.runner.subscribe((id, events) => {
      if (id !== taskId) return;
      if (!loaded) {
        pending.push(...events);
        return;
      }
      setTimeline((t) => events.reduce(reduceTimeline, t));
      if (events.some((e) => e.type === 'status')) void qc.invalidateQueries({ queryKey: ['task', taskId] });
    });
    void s.tasks.events(taskId).then((events) => {
      if (cancelled) return;
      loaded = true;
      setTimeline(buildTimeline([...events, ...pending]));
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [taskId, s, qc]);

  return { timeline, task: task.data ?? null, refresh: () => void task.refetch() };
}

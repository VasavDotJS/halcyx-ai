import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { buildTimeline, emptyTimeline, reduceTimeline, type Timeline } from '@/core/agent/timeline';
import type { TaskRecord } from '@/core/agent/taskStore';
import { useReadyServices } from './useServices';

/** Persisted events + live runner events folded into the activity timeline. */
export function useTaskStream(taskId: string): { timeline: Timeline; task: TaskRecord | null; refresh: () => void } {
  const s = useReadyServices();
  const [timeline, setTimeline] = useState<Timeline>(emptyTimeline);
  const loaded = useRef(false);

  const task = useQuery({ queryKey: ['task', taskId], queryFn: () => s.tasks.get(taskId), refetchInterval: 5_000 });

  useEffect(() => {
    let cancelled = false;
    loaded.current = false;
    const pending: Parameters<typeof reduceTimeline>[1][] = [];
    const unsubscribe = s.runner.subscribe((id, events) => {
      if (id !== taskId) return;
      if (!loaded.current) {
        pending.push(...events);
        return;
      }
      setTimeline((t) => events.reduce(reduceTimeline, t));
      if (events.some((e) => e.type === 'status')) void task.refetch();
    });
    void s.tasks.events(taskId).then((events) => {
      if (cancelled) return;
      loaded.current = true;
      setTimeline(buildTimeline([...events, ...pending]));
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, s]);

  return { timeline, task: task.data ?? null, refresh: () => void task.refetch() };
}

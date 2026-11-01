import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PROVIDER_ORDER } from '@/core/providers/registry';
import type { KeyValidation, ProviderId } from '@/core/types';
import { useReadyServices } from './useServices';

export type KeyState = { provider: ProviderId; saved: boolean; status: KeyValidation | null };

/** Which providers have a saved key + last validation result. Never returns the key itself. */
export function useKeys() {
  const s = useReadyServices();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['keys'],
    queryFn: async (): Promise<KeyState[]> =>
      Promise.all(PROVIDER_ORDER.map(async (p) => ({ provider: p, saved: await s.keys.has(p), status: await s.keys.status(p) }))),
  });
  const has = (p: ProviderId) => !!q.data?.find((k) => k.provider === p)?.saved;
  return { keys: q.data ?? [], has, invalidate: () => qc.invalidateQueries({ queryKey: ['keys'] }) };
}

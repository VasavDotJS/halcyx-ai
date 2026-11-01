import { useQuery } from '@tanstack/react-query';
import { services, type Services } from '@/core/app/services';

/** Lazily initialised singleton services (DB, stores, runner). */
export function useServices(): Services | null {
  return useServicesState().services;
}

export function useServicesState(): { services: Services | null; error: Error | null; retry: () => void } {
  const q = useQuery({ queryKey: ['services'], queryFn: services, staleTime: Infinity, gcTime: Infinity, retry: false });
  return { services: q.data ?? null, error: (q.error as Error | null) ?? null, retry: () => void q.refetch() };
}

/** Throws if used before services are ready — use inside screens rendered after the boot gate. */
export function useReadyServices(): Services {
  const s = useServices();
  if (!s) throw new Error('Services not ready');
  return s;
}

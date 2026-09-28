import { useQuery } from '@tanstack/react-query';
import type { SetupChecksView, SetupStatus, SetupSweepView } from '@postpile/core';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

/** Whether the setup flow shows on start, and the stored done / skipped flag. */
export function useSetupStatus() {
  return useQuery({
    queryKey: queryKeys.setupStatus,
    queryFn: () => request<SetupStatus>('GET', '/api/setup'),
  });
}

/** Step 1: runs gh and claude on the server each time, so only while that screen shows. "Check again" refetches. */
export function useSetupChecks(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.setupChecks,
    queryFn: () => request<SetupChecksView>('GET', '/api/setup/checks'),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** Fast enough for the live progress lines; the engine only reads memory. */
const SWEEP_REFRESH_MS = 1000;

/** Step 2: the sweep job, polled every second while it runs. Null before the first sweep in this server. */
export function useSetupSweep(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.setupSweep,
    queryFn: () => request<SetupSweepView | null>('GET', '/api/setup/sweep'),
    enabled,
    refetchInterval: (query) => (query.state.data?.running ? SWEEP_REFRESH_MS : false),
  });
}

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SyncProgress, SyncReport } from '@postpile/core';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

/** The last finished sync as the engine stored it (errors and timing included), so it survives a restart. Null before the first sync. */
export function useLastSyncReport() {
  return useQuery({
    queryKey: queryKeys.lastSync,
    queryFn: () => request<SyncReport | null>('GET', '/api/sync/last'),
  });
}

/** Fast enough for a seconds counter, cheap: the engine only reads counters. */
const PROGRESS_REFRESH_MS = 1000;

/**
 * The sync in flight (phases, agent calls done and planned so far), polled
 * only while this window waits on a sync. Null before the engine started it.
 */
export function useSyncProgress(syncing: boolean) {
  const queryClient = useQueryClient();
  // A finished sync's numbers must not flash up at the start of the next one.
  useEffect(() => {
    if (!syncing) {
      queryClient.removeQueries({ queryKey: queryKeys.syncProgress });
    }
  }, [syncing, queryClient]);
  return useQuery({
    queryKey: queryKeys.syncProgress,
    queryFn: () => request<SyncProgress | null>('GET', '/api/sync/progress'),
    enabled: syncing,
    refetchInterval: syncing ? PROGRESS_REFRESH_MS : false,
  });
}

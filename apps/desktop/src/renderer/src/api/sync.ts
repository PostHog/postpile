import { useQuery } from '@tanstack/react-query';
import type { SyncReport } from '@postpile/core';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

/** The last finished sync as the engine stored it (errors and timing included), so it survives a restart. Null before the first sync. */
export function useLastSyncReport() {
  return useQuery({
    queryKey: queryKeys.lastSync,
    queryFn: () => request<SyncReport | null>('GET', '/api/sync/last'),
  });
}

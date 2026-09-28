import { useQuery } from '@tanstack/react-query';
import type { PrDetail } from '@postpile/core';
import { prPath, request } from './client.ts';
import { queryKeys } from './keys.ts';

/** Detail pane: the full PR snapshot, its events, glance and the user's state. */
export function usePr(prKey: string | null) {
  return useQuery({
    queryKey: queryKeys.pr(prKey ?? ''),
    queryFn: () => request<PrDetail>('GET', prPath(prKey ?? '')),
    enabled: prKey !== null,
  });
}

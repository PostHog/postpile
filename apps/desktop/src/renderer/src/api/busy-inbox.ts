import { useQuery } from '@tanstack/react-query';
import type { BusyInboxView } from '@postpile/core';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

/**
 * The busy inbox card's numbers: whether the board cap cut the hot set on
 * the last load, what is kept per tier, the quiet rest, and whether GitHub
 * writes are locked. No timer of its own: the live poll's news and every
 * action refetch it like the topics.
 */
export function useBusyInbox() {
  return useQuery({
    queryKey: queryKeys.busyInbox,
    queryFn: () => request<BusyInboxView>('GET', '/api/busy-inbox'),
  });
}

import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { LivePollStatus } from '@postpile/core';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

/** The footer's refresh rate; the poll itself runs in the main process. */
const STATUS_REFRESH_MS = 5000;

/**
 * Status of the fast notification poll. When a poll cycle stored new
 * activity (changeCount moved), every other query refetches so tiles turn
 * unread without a "Sync now". Call once, in App.
 */
export function useLivePoll() {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: queryKeys.live,
    queryFn: () => request<LivePollStatus>('GET', '/api/live'),
    refetchInterval: STATUS_REFRESH_MS,
  });
  const changeCount = status.data?.changeCount;
  const lastSeen = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (changeCount === undefined) {
      return;
    }
    if (lastSeen.current !== undefined && lastSeen.current !== changeCount) {
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== queryKeys.config[0] && query.queryKey[0] !== queryKeys.live[0],
      });
    }
    lastSeen.current = changeCount;
  }, [changeCount, queryClient]);
  return status;
}

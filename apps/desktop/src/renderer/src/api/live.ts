import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { LivePollStatus } from '@postpile/core';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

/** The footer's refresh rate; the poll itself runs in the main process. */
const STATUS_REFRESH_MS = 5000;

/** The live status as a plain query: poll state, whether a sync runs, the next auto sync. Shared, so any component may read it. */
export function useLiveStatus() {
  return useQuery({
    queryKey: queryKeys.live,
    queryFn: () => request<LivePollStatus>('GET', '/api/live'),
    refetchInterval: STATUS_REFRESH_MS,
  });
}

/** What makes the rest of the UI stale when it moves: poll news, a catch-up run queued, started or done, a sync starting or ending. */
function refreshSignal(status: LivePollStatus | undefined): string | undefined {
  return status ? `${status.changeCount}:${status.catchUpChanges}:${status.syncRunning}` : undefined;
}

/**
 * Status of the fast notification poll. When a poll cycle stored new
 * activity (changeCount moved), a glance catch-up run moved
 * (catchUpChanges) or a background sync started or ended, every other query
 * refetches, so tiles turn unread and glances appear without a "Sync now".
 * Call once, in App.
 */
export function useLivePoll() {
  const queryClient = useQueryClient();
  const status = useLiveStatus();
  const signal = refreshSignal(status.data);
  const lastSeen = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (signal === undefined) {
      return;
    }
    if (lastSeen.current !== undefined && lastSeen.current !== signal) {
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== queryKeys.config[0] && query.queryKey[0] !== queryKeys.live[0],
      });
    }
    lastSeen.current = signal;
  }, [signal, queryClient]);
  return status;
}

/** When the next background full sync is due, for "next full sync in 42 min"; null while auto sync is off. */
export function useNextAutoSyncAt(): string | null {
  return useLiveStatus().data?.nextAutoSyncAt ?? null;
}

import { useQuery } from '@tanstack/react-query';
import type { InboxCleanupView } from '@postpile/core';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

/** While a cleanup runs, its progress is asked for every second. */
const RUNNING_REFETCH_MS = 1000;

/**
 * The inbox catch-up: unread merged PRs and old notifications, every pick
 * with what it clears, whether the start dialog is due, and a run in
 * progress (polled every second while one runs).
 */
export function useInboxCleanup() {
  return useQuery({
    queryKey: queryKeys.inboxCleanup,
    queryFn: () => request<InboxCleanupView>('GET', '/api/inbox-cleanup'),
    refetchInterval: (query) => (query.state.data?.running ? RUNNING_REFETCH_MS : false),
  });
}

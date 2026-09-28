import { useQuery } from '@tanstack/react-query';
import type { InboxCleanupView } from '@postpile/core';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

/** Old unread GitHub threads and how to show the cleanup (sidebar line, banner, none). */
export function useInboxCleanup() {
  return useQuery({
    queryKey: queryKeys.inboxCleanup,
    queryFn: () => request<InboxCleanupView>('GET', '/api/inbox-cleanup'),
  });
}

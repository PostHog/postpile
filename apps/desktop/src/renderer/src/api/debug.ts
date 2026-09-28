import { useQuery } from '@tanstack/react-query';
import type { NotificationDebugRow } from '@code-manager/core';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

/** Debug view: stored notification threads, newest first, with where each landed. Read only. */
export function useDebugNotifications(limit: number) {
  return useQuery({
    queryKey: queryKeys.debugNotifications(limit),
    queryFn: () => request<NotificationDebugRow[]>('GET', `/api/debug/notifications?limit=${limit}`),
  });
}

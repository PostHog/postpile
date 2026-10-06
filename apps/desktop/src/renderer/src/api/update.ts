import { useQuery } from '@tanstack/react-query';
import type { UpdateView } from '@postpile/core';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

/**
 * The server's last update check (it asks GitHub ~30s after start and then
 * every hour, and when the installer finds a release). Asking the local server is cheap, so every minute: the pill shows soon after the first check.
 */
export function useUpdate() {
  return useQuery({
    queryKey: queryKeys.update,
    queryFn: () => request<UpdateView>('GET', '/api/update'),
    refetchInterval: 60_000,
  });
}

import { useQuery } from '@tanstack/react-query';
import type { AppConfig } from '@code-manager/core';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

/** How the server runs: sample data or not, the sync call cap. Fixed for the process. GitHub writes are in writes.ts. */
export function useAppConfig() {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: () => request<AppConfig>('GET', '/api/config'),
    staleTime: Infinity,
  });
}

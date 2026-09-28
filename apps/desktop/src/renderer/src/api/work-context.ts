import { useQuery } from '@tanstack/react-query';
import type { WorkContextView } from '@postpile/core';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

/** While a sweep runs (the daily one or Refresh), look again every few seconds. */
const RUNNING_REFETCH_MS = 4000;

/** "What you're working on": the newest agent-written digest of local Claude Code notes. */
export function useWorkContext() {
  return useQuery({
    queryKey: queryKeys.workContext,
    queryFn: () => request<WorkContextView>('GET', '/api/work-context'),
    refetchInterval: (query) => (query.state.data?.running ? RUNNING_REFETCH_MS : false),
  });
}

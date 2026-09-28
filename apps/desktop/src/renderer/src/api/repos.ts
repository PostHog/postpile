import { useQuery } from '@tanstack/react-query';
import type { RepoOverview } from '@postpile/core';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

/** The title bar's repo menu: repos with their PR counts, the scope and the quiet repos. */
export function useRepos() {
  return useQuery({
    queryKey: queryKeys.repos,
    queryFn: () => request<RepoOverview>('GET', '/api/repos'),
  });
}

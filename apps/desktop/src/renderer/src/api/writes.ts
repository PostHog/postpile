import { useQuery } from '@tanstack/react-query';
import type { GitHubWritesStatus } from '@code-manager/core';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

/** The footer lock: GitHub writes on or off, and whether the env forces off. Changes at runtime. */
export function useGitHubWrites() {
  return useQuery({
    queryKey: queryKeys.githubWrites,
    queryFn: () => request<GitHubWritesStatus>('GET', '/api/github-writes'),
  });
}

import { useQuery } from '@tanstack/react-query';
import type { MemorySources, MemoryTarget } from '@code-manager/core';
import { targetKey, targetQuery } from '../lib/sources.ts';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

/** The "Why?" panel of a fact or dossier line. Only fetched while the panel is open. */
export function useMemorySources(target: MemoryTarget, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.memorySources(targetKey(target)),
    queryFn: () => request<MemorySources>('GET', `/api/memory/sources?${targetQuery(target)}`),
    enabled,
  });
}

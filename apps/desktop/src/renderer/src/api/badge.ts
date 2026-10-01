import { useQuery } from '@tanstack/react-query';
import type { BadgeView } from '@postpile/core';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

export function useBadge(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.badge,
    enabled,
    queryFn: () => request<BadgeView>('GET', '/api/badge'),
  });
}

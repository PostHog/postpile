import { useQuery } from '@tanstack/react-query';
import type { ScoutListItem } from '@postpile/core';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

/** The sidebar's Scouted section: one row per scout, in scouts.md order, with its unseen count (never unread). */
export function useScouts() {
  return useQuery({
    queryKey: queryKeys.scouts,
    queryFn: () => request<ScoutListItem[]>('GET', '/api/scouts'),
  });
}

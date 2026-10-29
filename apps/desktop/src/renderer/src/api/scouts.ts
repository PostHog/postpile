import { useQuery } from '@tanstack/react-query';
import type { ScoutIntroState, ScoutListItem } from '@postpile/core';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

/** The sidebar's Scouted section: one row per scout, in scouts.md order, with its unseen count (never unread). */
export function useScouts() {
  return useQuery({
    queryKey: queryKeys.scouts,
    queryFn: () => request<ScoutListItem[]>('GET', '/api/scouts'),
  });
}

/** The Scouts intro card: whether it opens by itself, and the repos for its picker. Actions refetch it. */
export function useScoutIntro() {
  return useQuery({
    queryKey: queryKeys.scoutIntro,
    queryFn: () => request<ScoutIntroState>('GET', '/api/scouts/intro'),
  });
}

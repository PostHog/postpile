import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PingFeedView, PingTarget } from '@postpile/core';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

const PING_FEED_REFRESH_MS = 5000;

export function usePingFeed(enabled: boolean) {
  const after = useRef<number | null>(null);
  return useQuery({
    queryKey: queryKeys.pings,
    enabled,
    refetchInterval: PING_FEED_REFRESH_MS,
    refetchIntervalInBackground: true,
    queryFn: async () => {
      const feed = await request<PingFeedView>('GET', after.current === null ? '/api/pings' : `/api/pings?after=${after.current}`);
      after.current = feed.latestId;
      return feed;
    },
  });
}

export async function fetchPingTarget(id: number): Promise<PingTarget | null> {
  return (await request<{ target: PingTarget | null }>('GET', `/api/pings/${id}/target`)).target;
}

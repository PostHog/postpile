import { useQuery } from '@tanstack/react-query';
import type { TopicDetail, TopicListItem } from '@postpile/core';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

/** Sidebar: every topic with unread counts, "needs you" first. */
export function useTopics() {
  return useQuery({
    queryKey: queryKeys.topics,
    queryFn: () => request<TopicListItem[]>('GET', '/api/topics'),
  });
}

/** Middle pane: one topic with its tiles, sets and pending proposals. */
export function useTopic(topicId: string | null) {
  return useQuery({
    queryKey: queryKeys.topic(topicId ?? ''),
    queryFn: () => request<TopicDetail>('GET', `/api/topics/${encodeURIComponent(topicId ?? '')}`),
    enabled: topicId !== null,
  });
}

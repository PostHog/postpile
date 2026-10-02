import { useQuery } from '@tanstack/react-query';
import type { FinishedTopic, TopicDetail, TopicListItem } from '@postpile/core';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

/** Sidebar: every topic with unread counts, "needs you" first. */
export function useTopics() {
  return useQuery({
    queryKey: queryKeys.topics,
    queryFn: () => request<TopicListItem[]>('GET', '/api/topics'),
  });
}

/** The sidebar's Archive drawer: retired topics that still take new PRs, newest first. */
export function useFinishedTopics() {
  return useQuery({
    queryKey: queryKeys.finishedTopics,
    queryFn: () => request<FinishedTopic[]>('GET', '/api/topics/finished'),
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

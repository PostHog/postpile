import { useQuery } from '@tanstack/react-query';
import type { ChatMessage } from '@postpile/core';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

/** The topic's agent chat ("Ask the agent"). Only fetched while the agent pane is open. */
export function useTopicChat(topicId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.topicChat(topicId),
    queryFn: () => request<ChatMessage[]>('GET', `/api/topics/${encodeURIComponent(topicId)}/chat`),
    enabled,
  });
}

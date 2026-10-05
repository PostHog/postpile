import { useQuery } from '@tanstack/react-query';
import type { ChatMessage } from '@postpile/core';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

/** The topic's agent chat ("Ask the agent"), read by the agent pane. */
export function useTopicChat(topicId: string) {
  return useQuery({
    queryKey: queryKeys.topicChat(topicId),
    queryFn: () => request<ChatMessage[]>('GET', `/api/topics/${encodeURIComponent(topicId)}/chat`),
  });
}

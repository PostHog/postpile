import { useQuery } from '@tanstack/react-query';
import type { LessonView } from '@postpile/core';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

/** The topic's open lessons ("Remember for future assessments?"), oldest first. */
export function useLessons(topicId: string | null) {
  return useQuery({
    queryKey: queryKeys.lessons(topicId ?? ''),
    queryFn: () => request<LessonView[]>('GET', `/api/topics/${encodeURIComponent(topicId ?? '')}/lessons`),
    enabled: topicId !== null,
  });
}

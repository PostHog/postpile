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

/** One lesson while it is open, wherever it sits now; null once decided. Shares the lessons prefix, so decisions refresh it. */
export function useLesson(id: number | null) {
  return useQuery({
    queryKey: queryKeys.lesson(id ?? 0),
    queryFn: () => request<LessonView | null>('GET', `/api/lessons/${id ?? 0}`),
    enabled: id !== null,
  });
}

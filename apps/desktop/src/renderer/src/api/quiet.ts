import { useQuery } from '@tanstack/react-query';
import type { QuietReadView } from '@postpile/core';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

/** "Handled quietly": threads PostPile marked read on GitHub by itself in the last 7 days, newest first. Read only. */
export function useHandledQuietly() {
  return useQuery({
    queryKey: queryKeys.handledQuietly,
    queryFn: () => request<QuietReadView[]>('GET', '/api/handled-quietly'),
  });
}

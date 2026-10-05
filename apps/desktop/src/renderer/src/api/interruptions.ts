import { useQuery } from '@tanstack/react-query';
import type { InterruptionsView } from '@postpile/core';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

/** When PostPile may show a Mac notification, and the roundup times. Changed through `useActions().setInterruptions`. */
export function useInterruptions() {
  return useQuery({
    queryKey: queryKeys.interruptions,
    queryFn: () => request<InterruptionsView>('GET', '/api/interruptions'),
  });
}

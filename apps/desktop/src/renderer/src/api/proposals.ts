import { useQuery } from '@tanstack/react-query';
import type { PendingProposals } from '@code-manager/core';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

/** Inbox: topic and standing-rule proposals waiting for the user, across topics. */
export function useProposals() {
  return useQuery({
    queryKey: queryKeys.proposals,
    queryFn: () => request<PendingProposals>('GET', '/api/proposals'),
  });
}

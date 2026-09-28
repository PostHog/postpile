import { useQuery } from '@tanstack/react-query';
import type { ViewerView } from '@postpile/core';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

/** Your login and teammates, for the sidebar's Mine and Team filter buttons. */
export function useViewer() {
  return useQuery({
    queryKey: queryKeys.viewer,
    queryFn: () => request<ViewerView>('GET', '/api/viewer'),
  });
}

import { useQuery } from '@tanstack/react-query';
import type { TeamRolesView } from '@postpile/core';
import { request } from './client.ts';
import { queryKeys } from './keys.ts';

/** Your teams with their roles (home or routing only), for "Your teams" under the instructions. */
export function useTeamRoles() {
  return useQuery({
    queryKey: queryKeys.teamRoles,
    queryFn: () => request<TeamRolesView>('GET', '/api/team-roles'),
  });
}

// Whose work a PR is, seen from the viewer: theirs, a home-team member's,
// or someone else's. MCP tags each PR with it and whats_on_me filters by it
// (author_scope). The owners are `prOwners` (a bot PR belongs to its
// assignees), like the app's "Your PR" and Team filter. "Your team" means
// the viewer's home teams only, never a team a review request names.
import { sameLogin } from './mentions.ts';
import { prOwners } from './pr-owners.ts';
import type { Pr } from './types.ts';

export type AuthorScope = 'me' | 'my_team' | 'others';

/** One home team and everyone on it, as the team member cache holds it. */
export interface HomeTeamMembers {
  /** "org/team-slug". */
  team: string;
  /** Every login on the team; the viewer may be among them. */
  members: string[];
}

export interface AuthorPlace {
  scope: AuthorScope;
  /** The home teams an owner is on ("org/team-slug"), for my_team; empty otherwise. */
  teams: string[];
}

/** 'me' when the viewer owns the PR, else 'my_team' when an owner is on one of `homeTeams`, else 'others'. */
export function authorPlace(pr: Pick<Pr, 'author' | 'assignees'>, viewerLogin: string | null, homeTeams: HomeTeamMembers[]): AuthorPlace {
  const owners = prOwners(pr);
  if (viewerLogin !== null && owners.some((owner) => sameLogin(owner, viewerLogin))) {
    return { scope: 'me', teams: [] };
  }
  const teams = homeTeams.filter((entry) => entry.members.some((member) => owners.some((owner) => sameLogin(owner, member)))).map((entry) => entry.team);
  return teams.length > 0 ? { scope: 'my_team', teams } : { scope: 'others', teams: [] };
}

// Team roles (DESIGN.md "Team roles", 2026-09-30). Each of the viewer's
// GitHub teams is a home team (its members are teammates: Team's PRs, the
// Team filter, faces, "For you" on a teammate's PR) or a routing team (only
// its review requests and mentions matter). Rules decide from how the
// viewer's reviews reached them; the user can flip a role. Rules only, no IO.
import { isOwnTeam, sameLogin } from './mentions.ts';
import type { IsoTime, Viewer } from './types.ts';

export type TeamRole = 'home' | 'routing';

/** A team is home when at least this share of the viewer's reviews came through its request. */
export const HOME_TEAM_SHARE = 0.2;
/** With fewer reviews than this in the window the share says too little: the team size decides alone. */
export const MIN_REVIEWS_FOR_SHARE = 30;
/**
 * A home team has at most this many members, whatever its share: a big
 * approver group asked on most PRs is not a set of teammates (2026-09-30).
 */
export const HOME_TEAM_MAX_MEMBERS = 10;
/** How far back the review history goes. */
export const TEAM_ROLE_WINDOW_DAYS = 90;
/** At most this many reviewed PRs are read. */
export const TEAM_ROLE_PR_CAP = 200;

/** One of the viewer's teams and how many members it has (null when GitHub did not say). */
export interface ViewerTeamSize {
  team: string;
  members: number | null;
}

/** A PR by someone else the viewer reviewed, with every reviewer requested on it. */
export interface ReviewedPr {
  key: string;
  /** Logins and "org/slug" teams from the PR's review request events, bot-made ones included. */
  requested: string[];
}

export interface ClassifyTeamsInput {
  login: string;
  teams: ViewerTeamSize[];
  reviews: ReviewedPr[];
}

/** What decided a role: the share of reviews, the size fallback, or the user. */
export type TeamRoleBasis = 'share' | 'size' | 'user';

export interface TeamClassification {
  team: string;
  role: TeamRole;
  basis: TeamRoleBasis;
  /** Reviews that came through this team's request. */
  reviews: number;
  /** `reviews` out of all the viewer's reviews, 0..1. Null without any reviews. */
  share: number | null;
  members: number | null;
}

/**
 * A review came through a team when the team was requested and the viewer
 * was not requested personally: a personal request wins, the review would
 * have come anyway.
 */
function cameThroughTeam(review: ReviewedPr, team: string, login: string): boolean {
  if (review.requested.some((subject) => sameLogin(subject, login))) {
    return false;
  }
  return review.requested.some((subject) => subject.includes('/') && isOwnTeam(subject, [team]));
}

/**
 * The rule: a team is home when it has at most HOME_TEAM_MAX_MEMBERS
 * members and at least HOME_TEAM_SHARE of the viewer's reviews came through
 * it (2026-09-30: share alone made a 40-person approver group home). With
 * fewer than MIN_REVIEWS_FOR_SHARE reviews the share says too little and
 * the size decides alone. An unknown size counts as small. No home team at
 * all is a valid answer.
 *
 * The basis names what decided: a share below the line decides whatever
 * the size ('share'), then a team too large ('size'), then the share
 * ('share', enough reviews) or the size ('size', too few).
 */
export function classifyTeams(input: ClassifyTeamsInput): TeamClassification[] {
  const total = input.reviews.length;
  const enoughReviews = total >= MIN_REVIEWS_FOR_SHARE;
  return input.teams.map(({ team, members }): TeamClassification => {
    const reviews = input.reviews.filter((review) => cameThroughTeam(review, team, input.login)).length;
    const share = total > 0 ? reviews / total : null;
    const numbers = { team, reviews, share, members };
    const small = members === null || members <= HOME_TEAM_MAX_MEMBERS;
    if (enoughReviews && reviews / total < HOME_TEAM_SHARE) {
      return { ...numbers, role: 'routing', basis: 'share' };
    }
    if (!small) {
      return { ...numbers, role: 'routing', basis: 'size' };
    }
    return { ...numbers, role: 'home', basis: enoughReviews ? 'share' : 'size' };
  });
}

/** One team's stored role. `source: 'user'` is a flip by the user and sticks. */
export interface TeamRoleEntry {
  role: TeamRole;
  source: 'auto' | 'user';
  basis: TeamRoleBasis;
  reviews: number;
  share: number | null;
  members: number | null;
}

/** The stored roles (meta `team_roles`), keyed by "org/slug". */
export interface TeamRoles {
  classifiedAt: IsoTime;
  /** How many of the viewer's reviews the last classification read. */
  reviewCount: number;
  teams: Record<string, TeamRoleEntry>;
}

/**
 * New classifications over the stored roles. A role the user set is never
 * overwritten (its numbers are refreshed); every other classified team
 * takes the new answer. Teams not classified this time keep their entry.
 */
export function mergeTeamRoles(previous: TeamRoles | null, classified: TeamClassification[], reviewCount: number, at: IsoTime): TeamRoles {
  const teams: Record<string, TeamRoleEntry> = { ...previous?.teams };
  for (const entry of classified) {
    const kept = teams[entry.team];
    const numbers = { reviews: entry.reviews, share: entry.share, members: entry.members };
    teams[entry.team] =
      kept?.source === 'user'
        ? { ...kept, ...numbers }
        : { role: entry.role, source: 'auto', basis: entry.basis, ...numbers };
  }
  return { classifiedAt: at, reviewCount, teams };
}

/** The user flips one team: the role sticks over later classifications. */
export function setTeamRole(roles: TeamRoles, team: string, role: TeamRole): TeamRoles {
  const kept = roles.teams[team] ?? { reviews: 0, share: null, members: null };
  return { ...roles, teams: { ...roles.teams, [team]: { ...kept, role, source: 'user', basis: 'user' } } };
}

/** The viewer's teams that have no stored role yet (all of them without roles). */
export function teamsWithoutRole(teams: string[], roles: TeamRoles | null): string[] {
  return teams.filter((team) => roles?.teams[team] === undefined);
}

/**
 * The viewer with `homeTeams` from the stored roles. A team without a role
 * yet counts as home until it is classified; without any roles the viewer
 * stays as it is (every team home).
 */
export function withHomeTeams(viewer: Viewer, roles: TeamRoles | null): Viewer {
  if (roles === null) {
    return viewer;
  }
  return { ...viewer, homeTeams: viewer.teams.filter((team) => roles.teams[team]?.role !== 'routing') };
}

/** The viewer's home teams: `homeTeams`, or every team before roles were decided. */
export function homeTeamsOf(viewer: Viewer): string[] {
  return viewer.homeTeams ?? viewer.teams;
}

/** The team ("org/slug" or the bare slug) is one of the viewer's home teams. */
export function isHomeTeam(team: string, viewer: Viewer): boolean {
  return isOwnTeam(team, homeTeamsOf(viewer));
}

/** The team is one of the viewer's teams, but only routes review requests and mentions to them. */
export function isRoutingTeam(team: string, viewer: Viewer): boolean {
  return isOwnTeam(team, viewer.teams) && !isHomeTeam(team, viewer);
}

/** A team list to compare: lower case, sorted. */
function comparableTeams(teams: string[]): string {
  return teams.map((team) => team.toLowerCase()).sort().join(',');
}

/**
 * The two viewers split their teams differently into home and routing
 * teams: a first classification that changed a role, a flip, a team joined
 * or left. Stored events carry loudness decided with the old split
 * (`routing team mention`), so they are derived again.
 */
export function teamRolesDiffer(before: Viewer, after: Viewer): boolean {
  const routing = (viewer: Viewer): string[] => viewer.teams.filter((team) => !isHomeTeam(team, viewer));
  return (
    comparableTeams(homeTeamsOf(before)) !== comparableTeams(homeTeamsOf(after)) ||
    comparableTeams(routing(before)) !== comparableTeams(routing(after))
  );
}

/** The viewer's teams, home teams first. */
export function teamsHomeFirst(viewer: Viewer): string[] {
  const home = homeTeamsOf(viewer);
  return [...home, ...viewer.teams.filter((team) => !home.includes(team))];
}

/** "acme/team-devex" -> "team-devex". */
function slugOf(team: string): string {
  return team.split('/').pop() ?? team;
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/**
 * Why a team has its role, in words: "57% of your reviews", "4 members",
 * "40 members, too many for a home team", "set by you".
 */
export function teamRoleReason(entry: TeamRoleEntry): string {
  if (entry.source === 'user') {
    return 'set by you';
  }
  if (entry.basis === 'share' && entry.share !== null) {
    return `${percent(entry.share)} of your reviews`;
  }
  if (entry.members === null) {
    return 'size unknown';
  }
  if (entry.role === 'routing') {
    return `${entry.members} members, too many for a home team`;
  }
  return `${entry.members} members`;
}

/**
 * The setup sweep's line: "Home team: team-devex (57% of your reviews came
 * through it) · Routing only: approvers (4% of your reviews came through
 * it)", or "No home team: your teams only route reviews to you · …".
 */
export function teamRolesLine(roles: TeamRoles, teams: string[]): string {
  const known = teams.filter((team) => roles.teams[team] !== undefined);
  const describe = (team: string): string => {
    const entry = roles.teams[team]!;
    const reason = entry.source === 'auto' && entry.basis === 'share' ? `${teamRoleReason(entry)} came through it` : teamRoleReason(entry);
    return `${slugOf(team)} (${reason})`;
  };
  const home = known.filter((team) => roles.teams[team]!.role === 'home');
  const routing = known.filter((team) => roles.teams[team]!.role === 'routing');
  const parts: string[] = [];
  if (home.length === 0) {
    parts.push('No home team: your teams only route reviews to you');
  } else {
    parts.push(`${home.length === 1 ? 'Home team' : 'Home teams'}: ${home.map(describe).join(', ')}`);
  }
  if (routing.length > 0) {
    parts.push(`Routing only: ${routing.map(describe).join(', ')}`);
  }
  return parts.join(' · ');
}

/** One of the viewer's teams as the setup sweep and the instructions pane show it. */
export interface TeamRoleView {
  /** "acme/team-devex": what a flip sends back. */
  team: string;
  /** "team-devex". */
  slug: string;
  role: TeamRole;
  source: 'auto' | 'user';
  /** Why, in words: "57% of your reviews", "4 members", "set by you", "not decided yet". */
  reason: string;
}

export interface TeamRolesView {
  teams: TeamRoleView[];
  /** Null before the first classification. */
  classifiedAt: IsoTime | null;
  /** The reviews the last classification read; null before the first. */
  reviewCount: number | null;
}

/** The viewer's teams in their order, each with its role. A team without a role yet shows as home. */
export function teamRolesView(teams: string[], roles: TeamRoles | null): TeamRolesView {
  return {
    teams: teams.map((team): TeamRoleView => {
      const entry = roles?.teams[team];
      if (!entry) {
        return { team, slug: slugOf(team), role: 'home', source: 'auto', reason: 'not decided yet' };
      }
      return { team, slug: slugOf(team), role: entry.role, source: entry.source, reason: teamRoleReason(entry) };
    }),
    classifiedAt: roles?.classifiedAt ?? null,
    reviewCount: roles?.reviewCount ?? null,
  };
}

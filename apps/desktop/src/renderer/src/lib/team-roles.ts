import type { TeamRole, TeamRoleView } from '@postpile/core';

/** "Home team" or "Routing only", the words next to a team. */
export function teamRoleWord(role: TeamRole): string {
  return role === 'home' ? 'Home team' : 'Routing only';
}

/** The flip button: to the other role. */
export function teamRoleFlipLabel(role: TeamRole): string {
  return role === 'home' ? 'Make routing only' : 'Make home team';
}

/** What a flip means, on the button's tooltip. */
export function teamRoleFlipTitle(team: TeamRoleView): string {
  if (team.role === 'home') {
    return `Only ${team.slug}'s review requests and mentions count; its members stop being your teammates. Local, sticks over later checks.`;
  }
  return `${team.slug}'s members become your teammates: Your team owns, the team PRs filter, "For you" on their PRs. Local, sticks over later checks.`;
}

/** The toast after a flip. */
export function teamRoleNotice(slug: string, role: TeamRole): string {
  return role === 'home' ? `${slug} is a home team: its members are your teammates` : `${slug} only routes reviews to you now`;
}

/** "Home team (57% of your reviews)". */
export function teamRoleLine(team: TeamRoleView): string {
  return `${teamRoleWord(team.role)} (${team.reason})`;
}

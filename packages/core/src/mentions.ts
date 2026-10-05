import type { Viewer } from './types.ts';
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * "@login" as a whole GitHub login, case-insensitive. Logins hold letters,
 * digits and dashes, so "@bob" in "@bob-helper" is not a mention of bob (a
 * plain \b would stop at the dash).
 */
export function mentionsUser(body: string, login: string): boolean {
  if (login === '') {
    return false;
  }
  return new RegExp(`@${escapeRegex(login)}(?![A-Za-z0-9-])`, 'i').test(body);
}

// Cannot reuse mentionsUser: a team is "@org/slug", and the slug must not run
// on ("@org/team" must not match "@org/team-other").
export function mentionsTeam(body: string, team: string): boolean {
  if (team === '') {
    return false;
  }
  return new RegExp(`@${escapeRegex(team)}(?:[^\\w/-]|$)`, 'i').test(body);
}

export function mentionsAnyTeam(body: string, teams: string[]): boolean {
  return teams.some((team) => mentionsTeam(body, team));
}

/**
 * Whether a requested team is one of the viewer's. Viewer teams come as
 * "org/slug"; PR review requests sometimes carry the bare slug.
 */
export function isOwnTeam(slug: string, teams: string[]): boolean {
  const wanted = slug.toLowerCase();
  return teams.some((mine) => {
    const lower = mine.toLowerCase();
    return lower === wanted || lower.endsWith(`/${wanted}`);
  });
}

export function sameLogin(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** A review request or similar subject (login or "org/team-slug") that is the viewer or one of their teams. */
export function isViewerSubject(subject: string | null | undefined, viewer: Viewer): boolean {
  if (!subject) {
    return false;
  }
  return sameLogin(subject, viewer.login) || isOwnTeam(subject, viewer.teams);
}

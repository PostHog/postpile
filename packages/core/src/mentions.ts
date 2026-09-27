function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Word-boundary match for "@login", case-insensitive. */
export function mentionsUser(body: string, login: string): boolean {
  if (login === '') {
    return false;
  }
  return new RegExp(`@${escapeRegex(login)}\\b`, 'i').test(body);
}

// Cannot reuse mentionsUser: \b treats a dash as a boundary and team slugs are
// full of dashes, so "@org/team" would also match "@org/team-other".
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

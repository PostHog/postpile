import { errorFromResponse, type GitHubHttp } from './http.ts';
import { nextPageUrl } from './notifications.ts';
import type { TeamMembersResult } from './reader.ts';

// A safety stop for a broken Link header. 20 pages x 100 is far past any real team.
const MAX_PAGES = 20;

/** "org/slug" -> "orgs/org/teams/slug/members?per_page=100". */
function membersPath(team: string): string {
  const [org = '', slug = ''] = team.split('/');
  return `orgs/${encodeURIComponent(org)}/teams/${encodeURIComponent(slug)}/members?per_page=100`;
}

/**
 * Every login on one team, all pages. Only the first page is conditional:
 * a 304 there means the team did not change. A team the token cannot read
 * (no read:org, SAML not authorized, team gone) answers an empty list
 * instead of failing the sync.
 */
export async function listTeamMembers(http: GitHubHttp, team: string, etag: string | null): Promise<TeamMembersResult> {
  const first = await http.request('GET', membersPath(team), { headers: etag ? { 'if-none-match': etag } : {} });
  if (first.status === 304) {
    return { notModified: true };
  }
  if (first.status === 403 || first.status === 404) {
    return { notModified: false, logins: [], etag: null };
  }
  if (!first.ok) {
    throw await errorFromResponse('GET team members', first);
  }
  const logins: string[] = [];
  let response = first;
  for (let page = 1; ; page++) {
    const members = (await response.json()) as { login: string }[];
    logins.push(...members.map((member) => member.login));
    const next = nextPageUrl(response.headers.get('link'));
    if (!next || page >= MAX_PAGES) {
      break;
    }
    response = await http.requestOk('GET', next);
  }
  return { notModified: false, logins, etag: first.headers.get('etag') };
}

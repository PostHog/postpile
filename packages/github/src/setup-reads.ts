// Read-only GitHub calls of the setup flow: the user's recent PR activity in
// one GraphQL request, a CODEOWNERS file by path, and a cheap check that the
// token can read notifications. DESIGN.md "Setup flow".
import { topLevelDirs, type ActivityPr, type ActivityRole, type PrState } from '@postpile/core';
import { errorFromResponse, type GitHubHttp } from './http.ts';

/** PRs per search alias; together they make the sweep's cap of about 100. */
export const ACTIVITY_SEARCH_SIZES: Record<ActivityRole, number> = {
  authored: 40,
  review_requested: 20,
  reviewed: 40,
};

/** Changed files read per PR, enough to tell which top-level folders it touches. */
const FILES_PER_PR = 50;

const ALIASES: Record<ActivityRole, string> = {
  authored: 'authored',
  review_requested: 'requested',
  reviewed: 'reviewed',
};

function searchPart(role: ActivityRole, search: string): string {
  return `  ${ALIASES[role]}: search(type: ISSUE, first: ${ACTIVITY_SEARCH_SIZES[role]}, query: ${JSON.stringify(search)}) {
    nodes { ... on PullRequest { number title url state updatedAt repository { nameWithOwner } files(first: ${FILES_PER_PR}) { nodes { path } } } }
  }`;
}

/**
 * One GraphQL request for the user's last weeks on GitHub: PRs they wrote,
 * PRs they reviewed (not their own) updated since `since` (YYYY-MM-DD), and
 * the reviews asked of them that are still open. Titles and file paths only.
 */
export function buildActivityQuery(since: string): string {
  const parts = [
    searchPart('authored', `is:pr author:@me updated:>=${since} sort:updated-desc`),
    searchPart('review_requested', 'is:pr is:open review-requested:@me sort:updated-desc'),
    searchPart('reviewed', `is:pr reviewed-by:@me -author:@me updated:>=${since} sort:updated-desc`),
  ];
  return `query {\n${parts.join('\n')}\n}`;
}

export interface RawActivityNode {
  number?: number;
  title?: string;
  url?: string;
  state?: string;
  updatedAt?: string;
  repository?: { nameWithOwner: string };
  files?: { nodes: ({ path: string } | null)[] } | null;
}

export type RawActivityResponse = Record<string, { nodes: (RawActivityNode | null)[] } | null>;

/**
 * The answer as one list: each PR once, in the order authored, review
 * requested, reviewed (a PR the user wrote is theirs first). Search hits
 * that are issues come back empty and are skipped, like aliases the token
 * could not answer.
 */
export function activityPrs(data: RawActivityResponse): ActivityPr[] {
  const seen = new Set<string>();
  const result: ActivityPr[] = [];
  for (const role of ['authored', 'review_requested', 'reviewed'] as ActivityRole[]) {
    for (const node of data[ALIASES[role]]?.nodes ?? []) {
      if (!node?.number || !node.repository || !node.updatedAt || !node.title) {
        continue;
      }
      const key = `${node.repository.nameWithOwner}#${node.number}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const paths = (node.files?.nodes ?? []).flatMap((file) => (file ? [file.path] : []));
      result.push({
        key,
        repo: node.repository.nameWithOwner,
        number: node.number,
        title: node.title,
        url: node.url ?? `https://github.com/${node.repository.nameWithOwner}/pull/${node.number}`,
        role,
        state: (node.state ?? 'OPEN') as PrState,
        updatedAt: new Date(node.updatedAt).toISOString(),
        dirs: topLevelDirs(paths),
      });
    }
  }
  return result;
}

/** "owner/name" + "path/in/repo" -> "repos/owner/name/contents/path/in/repo". */
function contentsPath(repo: string, path: string): string {
  const [owner = '', name = ''] = repo.split('/');
  const filePath = path.split('/').map(encodeURIComponent).join('/');
  return `repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${filePath}`;
}

/**
 * One file's text from the default branch through the contents API (raw
 * media type). Null when the file is not there or the token cannot see the
 * repo (404, 403); other failures throw.
 */
export async function readRepoFile(http: GitHubHttp, repo: string, path: string): Promise<string | null> {
  const response = await http.request('GET', contentsPath(repo, path), { headers: { accept: 'application/vnd.github.raw+json' } });
  if (response.status === 404 || response.status === 403) {
    return null;
  }
  if (!response.ok) {
    throw await errorFromResponse(`GET ${repo}/${path}`, response);
  }
  return response.text();
}

/**
 * Can this token read the notifications inbox? One page of one thread,
 * nothing marked read. Null when it can, else GitHub's reason (a classic
 * token without the notifications scope answers 403).
 */
export async function probeNotifications(http: GitHubHttp): Promise<string | null> {
  const response = await http.request('GET', 'notifications?per_page=1');
  if (response.ok) {
    return null;
  }
  return (await errorFromResponse('GET notifications', response)).message;
}

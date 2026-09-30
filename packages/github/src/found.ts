import type { FoundVia, IsoTime, PrRef } from '@postpile/core';

/** How many PRs one search alias asks for; the viewer's own PRs take 100. */
export const FOUND_SEARCH_SIZE = 50;
export const FOUND_OWN_SIZE = 100;
/** At most this many found PRs per sync, most aimed first. */
export const FOUND_CAP = 200;

/** A PR the finder query returned: enough to decide whether to fetch it. */
export interface FoundRef {
  ref: PrRef;
  updatedAt: IsoTime;
  via: FoundVia;
  /** "your open PR", "agent PR assigned to you", "review requested from you", "review requested from org/team", "involves you, merged 2026-09-24". */
  reason: string;
}

/** One alias of the finder query and what its hits mean. */
export interface FoundAlias {
  alias: string;
  via: FoundVia;
  /** The team for team_review_requested. */
  team: string | null;
  /** Keep only hits a bot opened: an assigned PR is the viewer's own only then (`prOwners`). */
  botAuthorsOnly: boolean;
}

export interface FoundQuery {
  query: string;
  aliases: FoundAlias[];
}

const PR_FIELDS = 'number updatedAt mergedAt repository { nameWithOwner }';

function searchAlias(alias: string, search: string, fields = PR_FIELDS): string {
  return `  ${alias}: search(type: ISSUE, first: ${FOUND_SEARCH_SIZE}, query: ${JSON.stringify(search)}) {
    nodes { ... on PullRequest { ${fields} } }
  }`;
}

/**
 * One GraphQL request for PRs the inbox may not show: the viewer's own open
 * PRs, open agent PRs a bot opened and assigned to them (their own too, see
 * `prOwners`), reviews asked of them and of each of their teams, and PRs
 * involving them merged since `mergedSince` (a date, YYYY-MM-DD). Only id-level
 * fields; the batched PR fetch gets the rest for new or changed ones.
 */
export function buildFoundQuery(teams: string[], mergedSince: string): FoundQuery {
  const aliases: FoundAlias[] = [
    { alias: 'own', via: 'own_open', team: null, botAuthorsOnly: false },
    { alias: 'assigned', via: 'own_open', team: null, botAuthorsOnly: true },
    { alias: 'review', via: 'review_requested', team: null, botAuthorsOnly: false },
    ...teams.map((team, index): FoundAlias => ({ alias: `team${index}`, via: 'team_review_requested', team, botAuthorsOnly: false })),
    { alias: 'merged', via: 'involved_merged', team: null, botAuthorsOnly: false },
  ];
  const parts = [
    `  own: viewer {
    pullRequests(states: OPEN, first: ${FOUND_OWN_SIZE}, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { ${PR_FIELDS} }
    }
  }`,
    searchAlias('assigned', 'is:pr is:open assignee:@me', `${PR_FIELDS} author { __typename }`),
    searchAlias('review', 'is:pr is:open user-review-requested:@me'),
    ...teams.map((team, index) => searchAlias(`team${index}`, `is:pr is:open team-review-requested:${team}`)),
    searchAlias('merged', `is:pr involves:@me is:merged merged:>=${mergedSince}`),
  ];
  return { query: `query {\n${parts.join('\n')}\n}`, aliases };
}

/** A PR node as the finder query returns it. Search hits that are issues come back empty. */
export interface RawFoundNode {
  number?: number;
  updatedAt?: string;
  mergedAt?: string | null;
  repository?: { nameWithOwner: string };
  /** Only asked for on the assigned alias. */
  author?: { __typename?: string } | null;
}

export type RawFoundResponse = Record<string, { nodes: (RawFoundNode | null)[] } | { pullRequests: { nodes: (RawFoundNode | null)[] } } | null>;

function reasonFor(alias: FoundAlias, node: RawFoundNode): string {
  switch (alias.via) {
    case 'own_open':
      return alias.botAuthorsOnly ? 'agent PR assigned to you' : 'your open PR';
    case 'review_requested':
      return 'review requested from you';
    case 'team_review_requested':
      return `review requested from ${alias.team ?? 'your team'}`;
    case 'involved_merged':
      return `involves you, merged ${(node.mergedAt ?? '').slice(0, 10)}`;
  }
}

/**
 * The finder answer as one list: each PR once, from the first alias in
 * query order that found it (review requests before merges), at most
 * FOUND_CAP. Aliases the token could not answer are null and skipped, and
 * so are a bot-only alias's hits that a person opened.
 */
export function foundRefs(query: FoundQuery, data: RawFoundResponse): FoundRef[] {
  const seen = new Set<string>();
  const result: FoundRef[] = [];
  const order: FoundVia[] = ['review_requested', 'team_review_requested', 'own_open', 'involved_merged'];
  const aliases = [...query.aliases].sort((a, b) => order.indexOf(a.via) - order.indexOf(b.via));
  for (const alias of aliases) {
    const answer = data[alias.alias];
    if (!answer) {
      continue;
    }
    const nodes = 'pullRequests' in answer ? answer.pullRequests.nodes : answer.nodes;
    for (const node of nodes) {
      if (!node?.number || !node.repository || !node.updatedAt) {
        continue;
      }
      if (alias.botAuthorsOnly && node.author?.__typename !== 'Bot') {
        continue;
      }
      const key = `${node.repository.nameWithOwner}#${node.number}`;
      if (seen.has(key) || result.length >= FOUND_CAP) {
        continue;
      }
      seen.add(key);
      result.push({
        ref: { repo: node.repository.nameWithOwner, number: node.number },
        updatedAt: new Date(node.updatedAt).toISOString(),
        via: alias.via,
        reason: reasonFor(alias, node),
      });
    }
  }
  return result;
}

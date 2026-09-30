import { isBotAuthor, type FoundVia, type IsoTime, type PrRef } from '@postpile/core';
import { actorLogin } from './normalize.ts';
import type { RawActor } from './raw.ts';

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
  /** "your open PR", "agent PR assigned to you", "assigned to you", "review requested from you", "review requested from org/team", "involves you, merged 2026-09-24". */
  reason: string;
}

/** One alias of the finder query and what its hits mean. */
export interface FoundAlias {
  alias: string;
  via: FoundVia;
  /** The team for team_review_requested. */
  team: string | null;
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
 * PRs, every open PR assigned to them (a bot's is their own, see
 * `prOwners`), reviews asked of them and of each of their teams, and PRs
 * involving them merged since `mergedSince` (a date, YYYY-MM-DD). Only id-level
 * fields; the batched PR fetch gets the rest for new or changed ones.
 */
export function buildFoundQuery(teams: string[], mergedSince: string): FoundQuery {
  const aliases: FoundAlias[] = [
    { alias: 'own', via: 'own_open', team: null },
    { alias: 'assigned', via: 'assigned', team: null },
    { alias: 'review', via: 'review_requested', team: null },
    ...teams.map((team, index): FoundAlias => ({ alias: `team${index}`, via: 'team_review_requested', team })),
    { alias: 'merged', via: 'involved_merged', team: null },
  ];
  const parts = [
    `  own: viewer {
    pullRequests(states: OPEN, first: ${FOUND_OWN_SIZE}, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { ${PR_FIELDS} }
    }
  }`,
    // The author tells an agent PR (a bot's, the viewer's own) from one a person assigned them.
    searchAlias('assigned', 'is:pr is:open assignee:@me', `${PR_FIELDS} author { __typename login }`),
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
  /** Only asked for on the assigned alias. Null for a deleted author. */
  author?: RawActor | null;
}

export type RawFoundResponse = Record<string, { nodes: (RawFoundNode | null)[] } | { pullRequests: { nodes: (RawFoundNode | null)[] } } | null>;

/**
 * An assigned PR a bot opened is the viewer's own (`prOwners`): found like
 * their own open PRs. One a person opened stays `assigned`: the author
 * still owns it. The login is read the way the PR fetch reads it
 * (`actorLogin`) and judged by the same rule as `prOwners`
 * (`isBotAuthor`), so automation without a [bot] suffix counts and a
 * deleted author does not.
 */
function viaFor(alias: FoundAlias, node: RawFoundNode): FoundVia {
  if (alias.via === 'assigned' && isBotAuthor(actorLogin(node.author))) {
    return 'own_open';
  }
  return alias.via;
}

function reasonFor(alias: FoundAlias, node: RawFoundNode): string {
  if (alias.via === 'assigned' && viaFor(alias, node) === 'own_open') {
    return 'agent PR assigned to you';
  }
  switch (alias.via) {
    case 'own_open':
      return 'your open PR';
    case 'assigned':
      return 'assigned to you';
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
 * FOUND_CAP. Aliases the token could not answer are null and skipped.
 */
export function foundRefs(query: FoundQuery, data: RawFoundResponse): FoundRef[] {
  const seen = new Set<string>();
  const result: FoundRef[] = [];
  const order: FoundVia[] = ['review_requested', 'team_review_requested', 'own_open', 'assigned', 'involved_merged'];
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
      const key = `${node.repository.nameWithOwner}#${node.number}`;
      if (seen.has(key) || result.length >= FOUND_CAP) {
        continue;
      }
      seen.add(key);
      result.push({
        ref: { repo: node.repository.nameWithOwner, number: node.number },
        updatedAt: new Date(node.updatedAt).toISOString(),
        via: viaFor(alias, node),
        reason: reasonFor(alias, node),
      });
    }
  }
  return result;
}

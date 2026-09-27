// Search bar filter: which topics, tiles and PRs match a query. Case-insensitive
// substring match; every whitespace-separated term must match (AND).

import { parsePrKey } from './keys.ts';
import type { PrKey } from './types.ts';

/** The searchable fields of one PR. */
export interface SearchablePr {
  key: PrKey;
  title: string;
  author: string;
  headRef: string;
}

export interface SearchableTile {
  tileId: string;
  prs: SearchablePr[];
}

export interface SearchableTopic {
  topicId: string;
  name: string;
  /** Null until the topic has a placement. */
  area: string | null;
  tiles: SearchableTile[];
}

export interface TopicSearchMatch {
  topicId: string;
  /** Matching tiles, in the order they were given. */
  tileIds: string[];
  /** PRs that matched, across those tiles, without repeats. */
  prKeys: PrKey[];
}

/** GET /api/search. Topics in the order they were given. */
export interface SearchResult {
  query: string;
  topics: TopicSearchMatch[];
}

/** "  Depot  #123 " -> ["depot", "#123"]. */
export function searchTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term !== '');
}

/** Everything a term may hit for one PR: its own fields plus its topic's name and area. */
function haystack(topic: SearchableTopic, pr: SearchablePr): string {
  const { repo, number } = parsePrKey(pr.key);
  return [pr.title, `#${number}`, pr.author, repo, pr.headRef, topic.name, topic.area ?? ''].join('\n').toLowerCase();
}

/**
 * A PR matches when every term is found in its fields or in its topic's name
 * and area, so "depot alice" finds alice's PRs in the Depot topic. A tile
 * matches when one of its PRs does, a topic when one of its tiles does. An
 * empty query matches nothing: the caller shows everything instead.
 */
export function searchTopics(topics: SearchableTopic[], query: string): SearchResult {
  const terms = searchTerms(query);
  const result: SearchResult = { query, topics: [] };
  if (terms.length === 0) {
    return result;
  }
  for (const topic of topics) {
    const tileIds: string[] = [];
    const prKeys = new Set<PrKey>();
    for (const tile of topic.tiles) {
      const matching = tile.prs.filter((pr) => {
        const text = haystack(topic, pr);
        return terms.every((term) => text.includes(term));
      });
      if (matching.length > 0) {
        tileIds.push(tile.tileId);
        for (const pr of matching) {
          prKeys.add(pr.key);
        }
      }
    }
    if (tileIds.length > 0) {
      result.topics.push({ topicId: topic.topicId, tileIds, prKeys: [...prKeys] });
    }
  }
  return result;
}

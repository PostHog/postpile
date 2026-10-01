// Where "Move to topic…" can send a tile, ranked. The renderer only draws the list.
import type { TilePerson } from './tile-people.ts';
import { sameLogin } from './mentions.ts';
import type { FinishedTopic, TopicListItem } from './views.ts';

/** Suggestions shown before the user types. */
export const MOVE_SUGGESTION_LIMIT = 5;
/** Matches shown for a search; the picker scrolls, this only keeps the list small. */
export const MOVE_SEARCH_LIMIT = 50;

export interface MoveTarget {
  id: string;
  name: string;
  /** Retired topic: only ever listed by a search. */
  finished: boolean;
  /** Why it is suggested; null for search matches. */
  reason: 'shared_people' | 'recent' | null;
}

export interface MoveTargets {
  /** suggestion: no query, a short list. search: the query matched topic names. */
  from: 'suggestion' | 'search';
  targets: MoveTarget[];
}

interface MoveTargetsInput {
  /** The tile being moved: its topic is left out, its people pick the topics that share them. */
  tile: { tile: { topicId: string }; people: TilePerson[] };
  /** Active topics. */
  topics: Pick<TopicListItem, 'topic' | 'people'>[];
  /** Retired topics; listed after the active matches of a search, never suggested. */
  finished: FinishedTopic[];
  query: string;
  limit?: number;
}

function byNewest(a: { updatedAt: string }, b: { updatedAt: string }): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

/**
 * No query: topics that share people with the tile (its authors and
 * reviewers, you left out: you are in every topic), most shared first, then
 * the most recently active topics. A query: active topics whose name
 * contains it, names that start with it first, then retired topics.
 * "Topics you recently moved tiles into" is not ranked: the renderer has
 * no feedback history to read it from.
 */
export function moveTargets(input: MoveTargetsInput): MoveTargets {
  const own = input.tile.tile.topicId;
  const others = input.topics.filter((item) => item.topic.id !== own).toSorted((a, b) => byNewest(a.topic, b.topic));
  const query = input.query.trim().toLowerCase();

  if (query === '') {
    const people = input.tile.people.filter((person) => person.role !== 'you');
    const shared = (item: Pick<TopicListItem, 'people'>) =>
      item.people.filter((face) => people.some((person) => sameLogin(person.login, face.login))).length;
    const sharing = others
      .map((item) => ({ item, shared: shared(item) }))
      .filter((entry) => entry.shared > 0)
      .toSorted((a, b) => b.shared - a.shared)
      .map((entry) => entry.item);
    const recent = others.filter((item) => !sharing.includes(item));
    const targets: MoveTarget[] = [
      ...sharing.map((item) => ({ id: item.topic.id, name: item.topic.name, finished: false, reason: 'shared_people' as const })),
      ...recent.map((item) => ({ id: item.topic.id, name: item.topic.name, finished: false, reason: 'recent' as const })),
    ];
    return { from: 'suggestion', targets: targets.slice(0, input.limit ?? MOVE_SUGGESTION_LIMIT) };
  }

  const matches = <T extends { name: string }>(list: T[]) => list.filter((entry) => entry.name.toLowerCase().includes(query));
  const startsWith = (name: string) => (name.toLowerCase().startsWith(query) ? 0 : 1);
  const active = matches(others.map((item) => ({ id: item.topic.id, name: item.topic.name })))
    .toSorted((a, b) => startsWith(a.name) - startsWith(b.name))
    .map((entry) => ({ ...entry, finished: false, reason: null }));
  const retired = matches(input.finished.filter((topic) => topic.id !== own).toSorted((a, b) => byNewest({ updatedAt: a.retiredAt }, { updatedAt: b.retiredAt }))).map(
    (topic) => ({ id: topic.id, name: topic.name, finished: true, reason: null }),
  );
  return { from: 'search', targets: [...active, ...retired].slice(0, input.limit ?? MOVE_SEARCH_LIMIT) };
}

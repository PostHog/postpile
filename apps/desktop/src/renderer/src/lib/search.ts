import type { SearchResult, TopicListItem } from '@code-manager/core';
import { sidebarGroups } from './sidebar.ts';

/** What the search bar lets through. Null means no filter: the query is empty or has no answer yet. */
export interface SearchFilter {
  /** Topic id -> matching tile ids. Topics not in here are hidden. */
  tilesByTopic: Map<string, Set<string>>;
  /** PRs that matched, so a tile opens on a matching PR rather than its lead. */
  prKeys: Set<string>;
  tileCount: number;
}

export function searchFilter(result: SearchResult | undefined): SearchFilter | null {
  if (!result) {
    return null;
  }
  const tilesByTopic = new Map(result.topics.map((match) => [match.topicId, new Set(match.tileIds)]));
  const tileCount = result.topics.reduce((sum, match) => sum + match.tileIds.length, 0);
  const prKeys = new Set(result.topics.flatMap((match) => match.prKeys));
  return { tilesByTopic, prKeys, tileCount };
}

/** The listed topics that match, in their API order. Without a filter, all of them. */
export function filterTopics(items: TopicListItem[], filter: SearchFilter | null): TopicListItem[] {
  return filter ? items.filter((item) => filter.tilesByTopic.has(item.topic.id)) : items;
}

/** Topics top to bottom as the sidebar shows them. */
export function sidebarOrder(items: TopicListItem[]): TopicListItem[] {
  const groups = sidebarGroups(items);
  return [...groups.needsYou, ...groups.team.flatMap((group) => group.items), ...groups.routed, ...groups.fyi];
}

/**
 * The topic to show: the picked one, unless a filter hides it, then the
 * first match in sidebar order. Without a pick, the first listed topic.
 */
export function visibleTopic(items: TopicListItem[], pickedId: string | null, filter: SearchFilter | null): TopicListItem | null {
  const picked = items.find((item) => item.topic.id === pickedId) ?? null;
  if (!filter) {
    return picked ?? items[0] ?? null;
  }
  if (picked && filter.tilesByTopic.has(picked.topic.id)) {
    return picked;
  }
  return sidebarOrder(filterTopics(items, filter))[0] ?? null;
}

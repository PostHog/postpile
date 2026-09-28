import type { SearchResult, TopicListItem } from '@postpile/core';
import { queueLayout } from './queues.ts';
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

/** Topics top to bottom as the sidebar shows them, each once (its first section). */
export function sidebarOrder(items: TopicListItem[]): TopicListItem[] {
  const layout = queueLayout(items);
  const groups = sidebarGroups(layout.other);
  const all = [
    ...layout.sections.flatMap((section) => section.rows.map((row) => row.item)),
    ...groups.needsYou,
    ...groups.team.flatMap((group) => group.items),
    ...groups.routed,
    ...groups.fyi,
  ];
  return all.filter((item, index) => all.indexOf(item) === index);
}

/**
 * The topic to show: the picked one, unless the search or a queue filter
 * hides it, then the first shown one in sidebar order. `shown` is null when
 * nothing narrows the list. Without a pick, the first listed topic.
 */
export function visibleTopic(items: TopicListItem[], pickedId: string | null, shown: TopicListItem[] | null): TopicListItem | null {
  const picked = items.find((item) => item.topic.id === pickedId) ?? null;
  if (!shown) {
    return picked ?? items[0] ?? null;
  }
  if (picked && shown.includes(picked)) {
    return picked;
  }
  return sidebarOrder(shown)[0] ?? null;
}

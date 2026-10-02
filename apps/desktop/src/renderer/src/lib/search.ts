import type { SearchResult, TopicListItem } from '@postpile/core';
import { hiddenAsDealt, sidebarBuckets } from './queues.ts';
import { areaFolds, otherTopicsGroups } from './sidebar.ts';

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

/** Topics top to bottom as the sidebar shows them, folds open and dealt-with topics in place; each sits in one section. */
export function sidebarOrder(items: TopicListItem[]): TopicListItem[] {
  return sidebarBuckets(items, false).flatMap((bucket) => {
    if (bucket.key === 'other_work') {
      return areaFolds(bucket.items).flatMap((fold) => fold.items);
    }
    if (bucket.key === 'other_topics') {
      const groups = otherTopicsGroups(bucket.items);
      return [...groups.unplaced, ...groups.fyi];
    }
    return bucket.items;
  });
}

/**
 * The topic to show: the picked one, unless the search or a queue filter
 * hides it. Then the kept one (what was on screen for this pick and these
 * filters, so an approve or a refetch that drops it from the filter does
 * not move the view), else the first shown one in sidebar order. `shown` is
 * null when nothing narrows the list. Without a pick, the sidebar's first listed topic.
 */
export function visibleTopic(
  items: TopicListItem[],
  pickedId: string | null,
  shown: TopicListItem[] | null,
  keptId: string | null = null,
): TopicListItem | null {
  const picked = items.find((item) => item.topic.id === pickedId) ?? null;
  if (!shown) {
    // The first row the sidebar lists: a topic behind a "+ N dealt with" line only when every one is.
    const order = sidebarOrder(items);
    return picked ?? order.find((item) => !hiddenAsDealt(item)) ?? order[0] ?? null;
  }
  if (picked && shown.includes(picked)) {
    return picked;
  }
  const kept = items.find((item) => item.topic.id === keptId);
  return kept ?? sidebarOrder(shown)[0] ?? null;
}

import type { TopicListItem, TopicRelation } from '@postpile/core';
import { unreadLook } from './queues.ts';

const RELATION_LABELS: Record<TopicRelation, string> = { team: 'team', routed: 'routed', fyi: 'FYI' };

export function relationLabel(relation: TopicRelation): string {
  return RELATION_LABELS[relation];
}

export interface AreaFold {
  /** The fold key: "area:<name>", or "more" for the shared fold. */
  key: string;
  label: string;
  items: TopicListItem[];
}

/**
 * The area folds inside Other work (DESIGN.md "Ownership sections"): areas
 * with two or more topics alphabetically, then "More" for single-topic
 * areas and topics without an area yet. Topics keep their order in a fold.
 */
export function areaFolds(items: TopicListItem[]): AreaFold[] {
  const counts = new Map<string, number>();
  for (const area of items.flatMap((item) => item.topic.area ?? [])) {
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  const named = [...counts].filter(([, count]) => count >= 2).map(([area]) => area).sort((a, b) => a.localeCompare(b));
  const folds = named.map((area) => ({ key: `area:${area}`, label: area, items: items.filter((item) => item.topic.area === area) }));
  const more = items.filter((item) => item.topic.area === null || !named.includes(item.topic.area));
  return more.length > 0 ? [...folds, { key: 'more', label: 'More', items: more }] : folds;
}

/**
 * A topic without a dossier yet: nothing tells whose it is, so it sits in
 * Other topics with a "not sorted yet" marker, unless an ask or a known
 * driver placed it elsewhere.
 */
export function isNotSorted(item: TopicListItem): boolean {
  return item.placement === null;
}

export interface OtherTopicsGroups {
  /** Topics nothing places yet (no dossier, or no driver and no owner team), listed open. */
  unplaced: TopicListItem[];
  /** FYI topics, folded by default. */
  fyi: TopicListItem[];
}

/** Inside Other topics: topics nothing places yet, then the FYI fold. */
export function otherTopicsGroups(items: TopicListItem[]): OtherTopicsGroups {
  return {
    unplaced: items.filter((item) => item.placement?.relation !== 'fyi'),
    fyi: items.filter((item) => item.placement?.relation === 'fyi'),
  };
}

/** The viewer's open PR or a move of theirs is in the topic. */
function holdsYours(item: TopicListItem): boolean {
  return item.queues.byYou > 0 || item.yourMoves.length > 0;
}

/**
 * Other work and its area folds start open when they hold the viewer's open
 * PR, a move of theirs or an unread topic; else folded.
 */
export function startsOpen(items: TopicListItem[]): boolean {
  return items.some((item) => holdsYours(item) || item.unreadTiles > 0);
}

/** The rows a folded fold keeps showing: urgent unread ones (coral), so nothing urgent hides. */
export function rowsWhileFolded(items: TopicListItem[]): TopicListItem[] {
  return items.filter((item) => unreadLook(item) === 'urgent');
}

/** "· 4 unread · 1 urgent" for a folded header, counted by topic; empty when nothing is unread. */
export function foldedSummary(items: TopicListItem[]): string {
  const unread = items.filter((item) => item.unreadTiles > 0).length;
  const urgent = rowsWhileFolded(items).length;
  const parts = [unread > 0 ? `${unread} unread` : null, urgent > 0 ? `${urgent} urgent` : null];
  return parts.flatMap((part) => (part === null ? [] : [`· ${part}`])).join(' ');
}

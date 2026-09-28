import type { PrSummary, PrTier, TileView, TopicListItem } from '@postpile/core';

/** Queue tiers in section order, same as core's PR_TIER_ORDER (the renderer imports types only). */
export const TIER_ORDER: PrTier[] = ['needs_reply', 'mine', 'team', 'to_review', 'team_mentioned', 'rest'];

/** The sidebar's filter buttons. */
export type QueueFilter = 'mine' | 'team' | 'reply' | 'review';

export const QUEUE_FILTERS: QueueFilter[] = ['mine', 'team', 'reply', 'review'];

/**
 * Mine / Team: open PRs you or a teammate wrote. Reply / Review: that tier.
 * A pulled-in stack layer never matches: it is context, outside the queues.
 * Neither does a PR in a quiet repo ("Let it go stale").
 */
export function prMatchesFilter(pr: PrSummary, filter: QueueFilter): boolean {
  if (pr.provenance.kind === 'pulled_in' || pr.quietRepo) {
    return false;
  }
  if (filter === 'mine') {
    return pr.authorRelation === 'you' && pr.state === 'OPEN';
  }
  if (filter === 'team') {
    return pr.authorRelation === 'team' && pr.state === 'OPEN';
  }
  return pr.tier === (filter === 'reply' ? 'needs_reply' : 'to_review');
}

export function tileMatchesFilter(view: TileView, filter: QueueFilter): boolean {
  return view.prs.some((pr) => prMatchesFilter(pr, filter));
}

/** How many of the topic's PRs the filter matches. */
export function topicFilterCount(item: TopicListItem, filter: QueueFilter): number {
  const { queues } = item;
  if (filter === 'mine') {
    return queues.byYou;
  }
  if (filter === 'team') {
    return queues.byTeam;
  }
  return queues.tiers[filter === 'reply' ? 'needs_reply' : 'to_review'];
}

/** Matching PRs over all topics, for the button counts. */
export function filterCounts(items: TopicListItem[]): Record<QueueFilter, number> {
  const sum = (filter: QueueFilter) => items.reduce((total, item) => total + topicFilterCount(item, filter), 0);
  return { mine: sum('mine'), team: sum('team'), reply: sum('reply'), review: sum('review') };
}

/** Topics with at least one matching PR, in their order. Without a filter, all of them. */
export function applyQueueFilter(items: TopicListItem[], filter: QueueFilter | null): TopicListItem[] {
  return filter ? items.filter((item) => topicFilterCount(item, filter) > 0) : items;
}

export interface QueueRow {
  item: TopicListItem;
  /** PRs of this section's tier in the topic. */
  count: number;
}

export interface QueueSection {
  tier: PrTier;
  rows: QueueRow[];
  /** PRs of this tier over the section's topics. */
  count: number;
}

export interface QueueLayout {
  /** Needs reply to Team mentioned; empty sections are left out. A topic can sit in several. */
  sections: QueueSection[];
  /** Topics with only rest PRs (or none). */
  other: TopicListItem[];
}

/** Topics keep the API order (urgent first) inside every section. */
export function queueLayout(items: TopicListItem[]): QueueLayout {
  const sections: QueueSection[] = [];
  for (const tier of TIER_ORDER.filter((entry) => entry !== 'rest')) {
    const rows = items.filter((item) => item.queues.tiers[tier] > 0).map((item) => ({ item, count: item.queues.tiers[tier] }));
    if (rows.length > 0) {
      sections.push({ tier, rows, count: rows.reduce((total, row) => total + row.count, 0) });
    }
  }
  const inSomeTier = (item: TopicListItem) => TIER_ORDER.some((tier) => tier !== 'rest' && item.queues.tiers[tier] > 0);
  return { sections, other: items.filter((item) => !inSomeTier(item)) };
}

/**
 * Inside To review: reviews for you (personal requests and team requests on
 * a teammate's PR, both "For you") before routed team requests. 0 elsewhere.
 */
function reviewRank(view: TileView): number {
  return view.tier === 'to_review' && view.forWhom.kind !== 'you' ? 1 : 0;
}

/** Tiles by queue, most urgent tier first; inside To review, reviews for you first; else the order inside a tier stays. */
export function tilesInTierOrder(views: TileView[]): TileView[] {
  return views.toSorted((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || reviewRank(a) - reviewRank(b));
}

/**
 * Unread on a topic row: coral when an unread tile is still open, grey when
 * every unread tile is merged or closed (news, nothing to act on), else none.
 */
export function unreadLook(item: TopicListItem): 'urgent' | 'calm' | null {
  if (item.urgentUnreadTiles > 0) {
    return 'urgent';
  }
  return item.unreadTiles > 0 ? 'calm' : null;
}

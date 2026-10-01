import type { PrSummary, PrTier, PrTierOrder, TileGroupOrder, TileView, TopicListItem } from '@postpile/core';
import type { Bucket } from './hold-place.ts';

/**
 * Queue tiers in section order: core's PR_TIER_ORDER. The renderer imports
 * types only, so this copy is typed with core's `PrTierOrder` and fails to
 * compile when the two differ.
 */
export const TIER_ORDER: PrTierOrder = ['needs_reply', 'changes_requested', 'mine', 'team', 'to_review', 'team_mentioned', 'rest'];

/**
 * The sidebar's "Topics with any PR | my PRs | team PRs" switch; null is
 * "any PR" (DESIGN.md "Topics with: the sidebar filter", 2026-10-01).
 * Reply and Review went: the Needs reply and To review sections are those.
 */
export type QueueFilter = 'mine' | 'team';

export const QUEUE_FILTERS: QueueFilter[] = ['mine', 'team'];

/**
 * The filter buttons to show. Without a home team there are no teammates,
 * so Team hides (2026-09-30), unless it is the active filter and needs its
 * button to be cleared.
 */
export function visibleQueueFilters(homeTeams: string[] | null | undefined, active: QueueFilter | null): QueueFilter[] {
  const noHomeTeam = homeTeams !== null && homeTeams !== undefined && homeTeams.length === 0;
  return QUEUE_FILTERS.filter((filter) => filter !== 'team' || !noHomeTeam || active === 'team');
}

/**
 * my PRs / team PRs: open PRs you or a teammate wrote. A pulled-in stack
 * layer never matches: it is context, outside the queues. Neither does a PR
 * in a quiet repo ("Let it go stale").
 */
export function prMatchesFilter(pr: PrSummary, filter: QueueFilter): boolean {
  if (pr.provenance.kind === 'pulled_in' || pr.quietRepo) {
    return false;
  }
  const relation = filter === 'mine' ? 'you' : 'team';
  return pr.authorRelation === relation && pr.state === 'OPEN';
}

/** How many of the topic's PRs the filter matches. */
function topicFilterCount(item: TopicListItem, filter: QueueFilter): number {
  return filter === 'mine' ? item.queues.byYou : item.queues.byTeam;
}

/** Matching PRs over all topics: a switch option with none is off. */
export function filterCounts(items: TopicListItem[]): Record<QueueFilter, number> {
  const sum = (filter: QueueFilter) => items.reduce((total, item) => total + topicFilterCount(item, filter), 0);
  return { mine: sum('mine'), team: sum('team') };
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
  /** Needs reply to Team mentioned; empty sections are left out. Each topic sits in one at most. */
  sections: QueueSection[];
  /** Topics with only rest PRs (or none). */
  other: TopicListItem[];
}

/**
 * Inside Changes you requested: topics where the move is a re-review (the
 * author addressed the changes or asked again) before topics still waiting
 * on the author.
 */
function changesRequestedRows(rows: QueueRow[]): QueueRow[] {
  const addressed = rows.filter((row) => row.item.queues.changesAddressed > 0);
  const waiting = rows.filter((row) => row.item.queues.changesAddressed === 0);
  return [...addressed, ...waiting];
}

/**
 * Each topic once, in the section core put it in (`TopicListItem.section`),
 * with that section's PR count.
 * Topics keep the API order (urgent first) inside a section, except that
 * Changes you requested lists addressed ones first.
 */
export function queueLayout(items: TopicListItem[]): QueueLayout {
  const sections: QueueSection[] = [];
  for (const tier of TIER_ORDER.filter((entry) => entry !== 'rest')) {
    const inTier = items.filter((item) => item.section === tier).map((item) => ({ item, count: item.queues.tiers[tier] }));
    const rows = tier === 'changes_requested' ? changesRequestedRows(inTier) : inTier;
    if (rows.length > 0) {
      sections.push({ tier, rows, count: rows.reduce((total, row) => total + row.count, 0) });
    }
  }
  return { sections, other: items.filter((item) => item.section === null) };
}

/** The sidebar layout as lists to hold a row in (`holdPlace`): every section, empty ones too, then Other topics. */
export function layoutBuckets(layout: QueueLayout): Bucket<QueueRow>[] {
  const sections = TIER_ORDER.filter((tier) => tier !== 'rest').map((tier) => ({
    key: tier,
    items: layout.sections.find((section) => section.tier === tier)?.rows ?? [],
  }));
  return [...sections, { key: 'other', items: layout.other.map((item) => ({ item, count: 0 })) }];
}

/** Back from `layoutBuckets`: empty sections left out, counts from each row's topic for its section's tier. */
export function layoutFromBuckets(buckets: Bucket<QueueRow>[]): QueueLayout {
  const sections: QueueSection[] = [];
  for (const bucket of buckets.filter((entry) => entry.key !== 'other' && entry.items.length > 0)) {
    const tier = bucket.key as PrTier;
    const rows = bucket.items.map((row) => ({ item: row.item, count: row.item.queues.tiers[tier] }));
    sections.push({ tier, rows, count: rows.reduce((total, row) => total + row.count, 0) });
  }
  return { sections, other: buckets.find((entry) => entry.key === 'other')?.items.map((row) => row.item) ?? [] };
}

/** A sidebar row's topic id, for `holdPlace`. */
export function queueRowId(row: QueueRow): string {
  return row.item.topic.id;
}

/**
 * Inside To review: reviews for you (personal requests and team requests on
 * a teammate's PR, both "For you") before routed team requests. Inside
 * Changes you requested: tiles on your move (the author addressed the
 * changes) before tiles waiting on the author. 0 elsewhere.
 */
function reviewRank(view: TileView): number {
  if (view.tier === 'to_review') {
    return view.forWhom.kind === 'you' ? 0 : 1;
  }
  if (view.tier === 'changes_requested') {
    return view.turn.kind === 'you' ? 0 : 1;
  }
  return 0;
}

/**
 * Tiles by queue, most urgent tier first; inside To review, reviews for you
 * first; inside Changes you requested, your move first; else the order
 * inside a tier stays.
 */
export function tilesInTierOrder(views: TileView[]): TileView[] {
  return views.toSorted((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || reviewRank(a) - reviewRank(b));
}

/**
 * Core's TILE_GROUP_ORDER. The renderer imports types only, so this copy is
 * typed with core's `TileGroupOrder` and fails to compile when the two differ.
 */
export const GROUP_ORDER: TileGroupOrder = ['unread', 'open', 'dealt_with'];

/** A tile holding a PR of your own (author, or a bot's PR assigned to you). */
function holdsYourPr(view: TileView): boolean {
  return view.prs.some((pr) => pr.authorRelation === 'you');
}

/**
 * The grid's groups (DESIGN.md "Groups inside a topic"): Unread, Open, Dealt
 * with, by core's `TileView.group`, empty ones included (the held place needs
 * them). Inside a group your own tiles come first, in every topic and view
 * (2026-10-01), then tier order; snoozed ones last.
 */
export function gridGroups(views: TileView[]): Bucket<TileView>[] {
  const ordered = tilesInTierOrder(views);
  const yoursFirst = [...ordered.filter(holdsYourPr), ...ordered.filter((view) => !holdsYourPr(view))];
  const awake = yoursFirst.filter((view) => view.state.kind !== 'snoozed');
  const snoozed = yoursFirst.filter((view) => view.state.kind === 'snoozed');
  return GROUP_ORDER.map((group) => ({ key: group, items: [...awake, ...snoozed].filter((view) => view.group === group) }));
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

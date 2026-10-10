import type { PrSummary, PrTierOrder, TileGroup, TileGroupOrder, TileView, TopicListItem, TopicSection, TopicSectionOrder } from '@postpile/core';
import type { Bucket } from './hold-place.ts';

/**
 * PR tiers in core's PR_TIER_ORDER, for the tiles inside a topic. The
 * renderer imports types only, so this copy is typed with core's
 * `PrTierOrder` and fails to compile when the two differ.
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

/**
 * Core's TOPIC_SECTION_ORDER. The renderer imports types only, so this copy
 * is typed with core's `TopicSectionOrder` and fails to compile when the two differ.
 */
export const SECTION_ORDER: TopicSectionOrder = [
  'needs_reply',
  'changes_requested',
  'to_review',
  'team_mentioned',
  'you_drive',
  'team_owns',
  'other_work',
  'other_topics',
  'archive',
];

/**
 * Inside Changes you requested: topics where the move is a re-review (the
 * author addressed the changes or asked again) before topics still waiting
 * on the author.
 */
function changesRequestedFirst(items: TopicListItem[]): TopicListItem[] {
  const addressed = items.filter((item) => item.queues.changesAddressed > 0);
  const waiting = items.filter((item) => item.queues.changesAddressed === 0);
  return [...addressed, ...waiting];
}

/**
 * The owner sections whose dealt-with topics (core's `quiet`) leave the list
 * for a "+ N dealt with" line (DESIGN.md "Dealt-with topics leave the
 * list"). The asks never hold a quiet topic; Other topics and the Archive
 * keep theirs.
 */
const DEALT_SECTIONS: TopicSection[] = ['you_drive', 'team_owns', 'other_work'];

/** A dealt-with topic in an owner section: it waits behind the section's "+ N dealt with" line while nothing narrows the list. */
export function hiddenAsDealt(item: TopicListItem): boolean {
  return item.quiet && DEALT_SECTIONS.includes(item.section);
}

/** The bucket key of a section's dealt-with topics, also its fold key. */
export function dealtKey(section: TopicSection): string {
  return `dealt:${section}`;
}

/**
 * Each topic once, in the section core put it in (`TopicListItem.section`):
 * every section in order, empty ones too, so a held row has its list to sit
 * in (`holdPlace`). The Archive is left out: its drawer lists retired
 * topics. Topics keep the API order (core's order inside a section), except
 * that Changes you requested lists addressed ones first. With `hideDealt`,
 * an owner section's quiet topics go to their own bucket right after it
 * (`dealtKey`), so the held place also keeps a row that turns quiet, or gets
 * news, while it is selected.
 */
export function sidebarBuckets(items: TopicListItem[], hideDealt: boolean): Bucket<TopicListItem>[] {
  return SECTION_ORDER.filter((section) => section !== 'archive').flatMap((section) => {
    const inSection = items.filter((item) => item.section === section);
    const ordered = section === 'changes_requested' ? changesRequestedFirst(inSection) : inSection;
    if (!hideDealt || !DEALT_SECTIONS.includes(section)) {
      return [{ key: section, items: ordered }];
    }
    return [
      { key: section, items: ordered.filter((item) => !hiddenAsDealt(item)) },
      { key: dealtKey(section), items: ordered.filter(hiddenAsDealt) },
    ];
  });
}

/** The topics of the bucket with this key, none when it is not there. */
function itemsOf(buckets: Bucket<TopicListItem>[], key: string): TopicListItem[] {
  return buckets.find((bucket) => bucket.key === key)?.items ?? [];
}

/** The topics of one section in the buckets, none when it is not there. */
export function bucketItems(buckets: Bucket<TopicListItem>[], section: TopicSection): TopicListItem[] {
  return itemsOf(buckets, section);
}

/** A section's dealt-with topics in the buckets, none when nothing is hidden. */
export function dealtItems(buckets: Bucket<TopicListItem>[], section: TopicSection): TopicListItem[] {
  return itemsOf(buckets, dealtKey(section));
}

/** A sidebar row's topic id, for `holdPlace`. */
export function topicRowId(item: TopicListItem): string {
  return item.topic.id;
}

/**
 * The section the sidebar draws a topic's row under, its held place
 * included, so the breadcrumb names the same one (BOARD-A-07). A dealt-with
 * row counts for its section. Null when the row is not in the buckets
 * (the Archive, a search that hides it).
 */
export function rowSection(buckets: Bucket<TopicListItem>[], topicId: string): TopicSection | null {
  const bucket = buckets.find((candidate) => candidate.items.some((item) => item.topic.id === topicId));
  if (bucket === undefined) {
    return null;
  }
  return SECTION_ORDER.find((section) => bucket.key === section || bucket.key === dealtKey(section)) ?? null;
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
 * The group a tile group's heading names. The selected tile keeps its place
 * while its group changes (`useHeldPlace`), so a heading can sit over tiles
 * that left its group: once none of them is in it any more and they all
 * share another group, the heading names that one. "Unread 1" over the tile
 * the read just landed on becomes "Dealt with 1" in place (2026-10-07), so
 * no coral claims an unread that is gone. Mixed or empty: the bucket's own.
 */
export function headingGroup(bucket: TileGroup, groups: TileGroup[]): TileGroup {
  const first = groups[0];
  if (first === undefined || groups.includes(bucket)) {
    return bucket;
  }
  return groups.every((group) => group === first) ? first : bucket;
}

/** Group names on screen. "Dealt with" is the tile state `done`; a topic with nothing left goes to the Archive. */
export const GROUP_LABELS: Record<TileGroup, string> = { unread: 'Unread', open: 'Open', dealt_with: 'Dealt with' };

/**
 * The words of a group heading: the name of `headingGroup`, unless that
 * group already has its own heading on screen. Then the renamed heading
 * says what just happened instead ("Just read" over the tile the read
 * landed on), so a topic never shows two "Dealt with" headings (BOARD-A-10).
 */
export function headingLabel(bucket: TileGroup, shown: TileGroup, onScreen: TileGroup[]): string {
  if (shown === bucket || !onScreen.includes(shown)) {
    return GROUP_LABELS[shown];
  }
  return bucket === 'unread' ? 'Just read' : `Now ${GROUP_LABELS[shown].toLowerCase()}`;
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

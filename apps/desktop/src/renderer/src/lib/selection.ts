// What stays on screen. The user's pick holds until the user navigates or
// changes a filter: an approve, a refetch, a poll or a sync never moves it,
// even when the picked topic or tile no longer matches the filter.
import type { PrSummary, TileView, TopicListItem } from '@postpile/core';
import type { NavEntry } from './history.ts';
import { firstGridTile } from './queues.ts';
import { leadPr } from './tiles.ts';

/**
 * What was on screen for one pick (nav entry) under one filter. While both
 * stay the same, this is shown again even when it stops matching the filter.
 */
export interface KeptView {
  filterKey: string;
  entry: NavEntry;
  topicId: string | null;
  tileId: string | null;
  prKey: string | null;
}

/**
 * The filters the user set: the queue filter and the query the shown search
 * results answer (null while no search filters). Changes only when the user
 * changes a filter and its results arrive, never on a refetch.
 */
export function filterKey(queueFilter: string | null, searchedFor: string | null): string {
  return `${queueFilter ?? ''}|${searchedFor ?? ''}`;
}

function sameEntry(a: NavEntry, b: NavEntry): boolean {
  return a.pane === b.pane && a.topicId === b.topicId && a.tileId === b.tileId && a.prKey === b.prKey;
}

/** The kept view while the pick and the filters are still the ones it was kept for, else null. */
export function keptFor(kept: KeptView | null, entry: NavEntry, key: string): KeptView | null {
  if (!kept || kept.filterKey !== key || !sameEntry(kept.entry, entry)) {
    return null;
  }
  return kept;
}

/**
 * What to keep after this render: what is shown now. Returns `previous`
 * itself when nothing changed, so a state update can be skipped. Another
 * pane keeps the last topic view for the way back; tiles still loading
 * (`shown.tileId` null on the same topic) keep the last tile.
 */
export function nextKept(previous: KeptView | null, key: string, entry: NavEntry, shown: NavEntry): KeptView | null {
  if (entry.pane !== 'topic') {
    return previous;
  }
  const still = keptFor(previous, entry, key);
  if (still && shown.tileId === null && still.topicId === shown.topicId) {
    return still;
  }
  if (still && still.topicId === shown.topicId && still.tileId === shown.tileId && still.prKey === shown.prKey) {
    return still;
  }
  return { filterKey: key, entry, topicId: shown.topicId, tileId: shown.tileId, prKey: shown.prKey };
}

/**
 * The sidebar's topics: the ones the filters let through, plus the open
 * topic when it is only kept on screen, in API order.
 */
export function listedTopics(items: TopicListItem[], shown: TopicListItem[], activeId: string | null): TopicListItem[] {
  if (activeId === null || shown.some((item) => item.topic.id === activeId)) {
    return shown;
  }
  return items.filter((item) => shown.includes(item) || item.topic.id === activeId);
}

function tileHolding(tiles: TileView[], prKey: string | null): TileView | undefined {
  if (prKey === null) {
    return undefined;
  }
  return tiles.find((view) => view.prs.some((pr) => pr.key === prKey));
}

function keptTile(tiles: TileView[], kept: KeptView | null): TileView | undefined {
  if (!kept) {
    return undefined;
  }
  return tiles.find((view) => view.tile.id === kept.tileId) ?? tileHolding(tiles, kept.prKey);
}

function prIn(view: TileView, prKey: string | null | undefined): PrSummary | undefined {
  return view.prs.find((pr) => pr.key === prKey);
}

/**
 * The tile and PR to show, in this order:
 * 1. the picked tile, among the tiles the search lets through;
 * 2. the tile that now holds the picked PR (a set regrouped, a PR left a stack);
 * 3. the kept tile (by id, else by its PR) among all the topic's tiles, so a
 *    tile that stops matching the search after a refetch stays;
 * 4. the grid's first shown tile.
 * The PR: the picked one, else the kept one, else the first matching the
 * search, else the tile's lead PR. `kept` must belong to this topic.
 */
export function resolveSelection(
  entry: NavEntry,
  shownTiles: TileView[],
  allTiles: TileView[],
  matchingPrKeys: Set<string> | null,
  kept: KeptView | null,
): { view: TileView | null; prKey: string | null } {
  const view =
    shownTiles.find((candidate) => candidate.tile.id === entry.tileId) ??
    tileHolding(shownTiles, entry.prKey) ??
    keptTile(allTiles, kept) ??
    firstGridTile(shownTiles);
  if (!view) {
    return { view: null, prKey: null };
  }
  const matching = matchingPrKeys ? view.prs.find((pr) => matchingPrKeys.has(pr.key)) : undefined;
  const pr = prIn(view, entry.prKey) ?? prIn(view, kept?.prKey) ?? matching ?? leadPr(view);
  return { view, prKey: pr?.key ?? null };
}

/** The search's matching tile ids plus the selected tile, so the grid never hides what is open. */
export function withSelectedTile(tileIds: Set<string> | null, selectedTileId: string | null): Set<string> | null {
  if (!tileIds || selectedTileId === null || tileIds.has(selectedTileId)) {
    return tileIds;
  }
  return new Set([...tileIds, selectedTileId]);
}

/** The grid's Unread list: unread tiles, plus the selected one while it is selected (it just got read). */
export function unreadTiles(views: TileView[], selectedTileId: string | null): TileView[] {
  return views.filter((view) => view.state.kind === 'unread' || view.tile.id === selectedTileId);
}

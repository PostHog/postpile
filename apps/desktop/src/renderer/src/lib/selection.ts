// What stays on screen. The user's pick holds until the user navigates or
// changes a filter: an approve, a refetch, a poll or a sync never moves it,
// even when the picked topic or tile no longer matches the filter.
import type { PrSummary, TileView, TopicListItem } from '@postpile/core';
import type { NavEntry } from './history.ts';
import { tilesInTierOrder } from './queues.ts';
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
  /**
   * Set while the app picked this tile (`autoTile`), the user did not, with
   * the grid filter and tile state it was picked under. An auto pick is
   * re-run when the filter changes and turns into a user-like pick (kept
   * visible in the grid) once its state changes while shown.
   */
  auto?: AutoPick | null;
}

export interface AutoPick {
  tileFilter: TileFilter;
  state: TileView['state']['kind'];
}

/** The grid's own filter: every live tile, or only the unread ones. */
export type TileFilter = 'all' | 'unread';

/**
 * The tile the app selects when the user has not picked one (2026-09-29):
 * the first unread tile in tier order; under All also the first open one;
 * never a snoozed or done tile. Under Unread with nothing unread: none.
 */
export function autoTile(views: TileView[], tileFilter: TileFilter): TileView | null {
  const ordered = tilesInTierOrder(views);
  const unread = ordered.find((view) => view.state.kind === 'unread');
  if (unread || tileFilter === 'unread') {
    return unread ?? null;
  }
  return ordered.find((view) => view.state.kind === 'open') ?? null;
}

/** The detail pane's line when no tile is selected. */
export function noSelectionText(tileFilter: TileFilter): string {
  return tileFilter === 'unread' ? 'Nothing unread in this topic. Pick a tile, or show All.' : 'Pick a tile to see it.';
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

function sameAuto(a: AutoPick | null, b: AutoPick | null): boolean {
  return a === b || (a !== null && b !== null && a.tileFilter === b.tileFilter && a.state === b.state);
}

/**
 * What to keep after this render: what is shown now. Returns `previous`
 * itself when nothing changed, so a state update can be skipped. Another
 * pane keeps the last topic view for the way back; tiles still loading
 * (`shown.tileId` null on the same topic) keep the last tile.
 */
export function nextKept(previous: KeptView | null, key: string, entry: NavEntry, shown: NavEntry, auto: AutoPick | null = null): KeptView | null {
  if (entry.pane !== 'topic') {
    return previous;
  }
  const still = keptFor(previous, entry, key);
  if (still && shown.tileId === null && still.topicId === shown.topicId) {
    return still;
  }
  if (still && still.topicId === shown.topicId && still.tileId === shown.tileId && still.prKey === shown.prKey && sameAuto(still.auto ?? null, auto)) {
    return still;
  }
  return { filterKey: key, entry, topicId: shown.topicId, tileId: shown.tileId, prKey: shown.prKey, auto };
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
 * The tile and PR to show, in this order (`deselected` shows none):
 * 1. the picked tile, among the tiles the search lets through;
 * 2. the tile that now holds the picked PR (a set regrouped, a PR left a stack);
 * 3. the kept tile (by id, else by its PR) among all the topic's tiles, so a
 *    tile that stops matching the search after a refetch stays;
 * 4. `autoTile` of the shown tiles (`auto` true; none under Unread with
 *    nothing unread).
 * The PR: the picked one, else the kept one, else the first matching the
 * search, else the tile's lead PR. `kept` must belong to this topic.
 */
export function resolveSelection(
  entry: NavEntry,
  shownTiles: TileView[],
  allTiles: TileView[],
  matchingPrKeys: Set<string> | null,
  kept: KeptView | null,
  tileFilter: TileFilter = 'all',
  deselected = false,
): { view: TileView | null; prKey: string | null; auto: boolean } {
  // Switching the grid to Unread clears the selection: nothing is picked, kept or auto-selected until the next pick.
  if (deselected) {
    return { view: null, prKey: null, auto: false };
  }
  const picked = shownTiles.find((candidate) => candidate.tile.id === entry.tileId) ?? tileHolding(shownTiles, entry.prKey);
  // An auto pick made under another grid filter is picked again.
  const usableKept = kept?.auto && kept.auto.tileFilter !== tileFilter ? null : kept;
  const keptView = picked ? undefined : keptTile(allTiles, usableKept);
  const view = picked ?? keptView ?? autoTile(shownTiles, tileFilter);
  if (!view) {
    return { view: null, prKey: null, auto: false };
  }
  // Auto until its state changes while shown: then it counts as the user's, so pane and grid agree.
  const auto = !picked && (keptView ? usableKept?.auto?.state === view.state.kind : true);
  const matching = matchingPrKeys ? view.prs.find((pr) => matchingPrKeys.has(pr.key)) : undefined;
  const pr = prIn(view, entry.prKey) ?? prIn(view, kept?.prKey) ?? matching ?? leadPr(view);
  return { view, prKey: pr?.key ?? null, auto };
}

/** The search's matching tile ids plus the selected tile, so the grid never hides what is open. */
export function withSelectedTile(tileIds: Set<string> | null, selectedTileId: string | null): Set<string> | null {
  if (!tileIds || selectedTileId === null || tileIds.has(selectedTileId)) {
    return tileIds;
  }
  return new Set([...tileIds, selectedTileId]);
}

/**
 * A tile the Unread filter matches: core's `unread` state, or a snoozed tile
 * whose thread is unread on GitHub (it keeps its snooze). Nothing else.
 */
export function isUnreadTile(view: TileView): boolean {
  return view.state.kind === 'unread' || (view.state.kind === 'snoozed' && view.state.unreadOnGitHub);
}

/**
 * The grid's Unread list: every unread tile, and a snoozed one whose thread
 * is unread on GitHub (it keeps its snooze), plus the selected one while it
 * is selected (it just got read).
 */
export function unreadTiles(views: TileView[], selectedTileId: string | null): TileView[] {
  return views.filter((view) => isUnreadTile(view) || view.tile.id === selectedTileId);
}

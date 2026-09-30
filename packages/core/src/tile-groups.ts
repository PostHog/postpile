// The three groups inside a topic (DESIGN.md "Groups inside a topic",
// 2026-09-30): Unread, Open, Dealt with, always in this order. Core decides
// which group a tile is in; the renderer and MCP only show it.
import type { TileState } from './types.ts';

/**
 * unread: the tile is unread ("GitHub unread is PostPile unread"), a snoozed
 * tile with a thread unread on GitHub too. open: read, not dealt with (your
 * move, waiting on someone, or snoozed). dealt_with: the tile state is done.
 */
export type TileGroup = 'unread' | 'open' | 'dealt_with';

/**
 * The group order inside a topic. The renderer imports types only, so its
 * copy is typed `TileGroupOrder` and fails to compile if the two differ.
 */
export type TileGroupOrder = readonly ['unread', 'open', 'dealt_with'];

export const TILE_GROUP_ORDER: TileGroupOrder = ['unread', 'open', 'dealt_with'];

/** How the groups are named where they label tiles. "Done" stays the internal state name. */
export const TILE_GROUP_LABELS: Record<TileGroup, string> = {
  unread: 'Unread',
  open: 'Open',
  dealt_with: 'Dealt with',
};

/** The tile's group: unread (a snoozed tile with an unread thread too), else dealt with when done, else open. */
export function tileGroup(state: Pick<TileState, 'kind' | 'unreadOnGitHub'>): TileGroup {
  if (state.kind === 'unread' || (state.kind === 'snoozed' && state.unreadOnGitHub)) {
    return 'unread';
  }
  return state.kind === 'done' ? 'dealt_with' : 'open';
}

export interface GroupOfTiles<T> {
  group: TileGroup;
  tiles: T[];
}

/** The tiles by group in `TILE_GROUP_ORDER`, each keeping its order; empty groups are left out. */
export function groupTiles<T extends { group: TileGroup }>(tiles: T[]): GroupOfTiles<T>[] {
  return TILE_GROUP_ORDER.map((group) => ({ group, tiles: tiles.filter((tile) => tile.group === group) })).filter((entry) => entry.tiles.length > 0);
}

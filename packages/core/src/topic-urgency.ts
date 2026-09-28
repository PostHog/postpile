// When a topic counts as "needs you" in the sidebar: prominent coral unread,
// placed on top. Unread alone is not enough: a topic whose unread tiles are
// all merged or closed only has news to read, nothing to act on.
import type { PrState, TileStateKind } from './types.ts';

/** One tile of the topic, as far as urgency cares. */
export interface UrgencyTile {
  state: TileStateKind;
  /** States of the tile's PRs outside quiet repos (all of them when none is quiet). */
  prStates: PrState[];
  /** Whose turn says it is the viewer's move. */
  yourMove: boolean;
  /** That move is only "Merge, it is approved" on the viewer's own PR (`isMergeApprovedMove`). */
  mergeApproved: boolean;
  /** Every PR of the tile is in a quiet repo ("Let it go stale"): it never makes the topic urgent. */
  quiet: boolean;
}

export interface TopicUrgency {
  /** Unread tiles, open or not. The tiles still show each one as unread. */
  unreadTiles: number;
  /** Unread tiles with at least one open PR. These light up the topic. */
  urgentUnreadTiles: number;
  /** Live (not done, not snoozed) tiles where it is the viewer's move, merging an approved PR included. */
  yourMoveTiles: number;
  /**
   * An unread tile is still open, or it is the viewer's move on a live tile
   * and that move is more than merging their own approved PR. Quiet and
   * snoozed tiles never count as a move.
   */
  needsYou: boolean;
}

export function isUrgentUnread(tile: UrgencyTile): boolean {
  return !tile.quiet && tile.state === 'unread' && tile.prStates.includes('OPEN');
}

export function topicUrgency(tiles: UrgencyTile[]): TopicUrgency {
  const unreadTiles = tiles.filter((tile) => tile.state === 'unread').length;
  const urgentUnreadTiles = tiles.filter(isUrgentUnread).length;
  const yourMove = tiles.filter((tile) => tile.state !== 'done' && tile.state !== 'snoozed' && tile.yourMove);
  const urgentMoves = yourMove.filter((tile) => !tile.mergeApproved && !tile.quiet).length;
  return { unreadTiles, urgentUnreadTiles, yourMoveTiles: yourMove.length, needsYou: urgentUnreadTiles > 0 || urgentMoves > 0 };
}

/** The fields `compareTopicUrgency` reads; `TopicListItem` has them all. */
export interface RankedTopic {
  group: 'needs_you' | 'quiet';
  urgentUnreadTiles: number;
  unreadTiles: number;
}

/**
 * Needs-you topics first, then more open unread tiles, then more unread
 * tiles of any kind (merged since you looked). 0 on a tie, so callers add
 * their own tie-break.
 */
export function compareTopicUrgency(a: RankedTopic, b: RankedTopic): number {
  if (a.group !== b.group) {
    return a.group === 'needs_you' ? -1 : 1;
  }
  if (a.urgentUnreadTiles !== b.urgentUnreadTiles) {
    return b.urgentUnreadTiles - a.urgentUnreadTiles;
  }
  return b.unreadTiles - a.unreadTiles;
}

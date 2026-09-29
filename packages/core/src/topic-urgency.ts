// When a topic counts as "needs you" in the sidebar: prominent coral unread,
// placed on top. Unread alone is not enough: a topic whose unread tiles are
// all merged or closed only has news to read, nothing to act on.
import type { PrState, TileStateKind } from './types.ts';
import { YOUR_MOVE_ORDER, type WhoseTurn, type YourMove } from './whose-turn.ts';

/** The viewer's move on one tile, for the sidebar row's chip: its kind and the tile footer's words. */
export interface TopicMove {
  move: YourMove;
  /** The tile's `turn.what`, "Review, rowan asked". */
  text: string;
}

/** The tile's move when whose turn says it is the viewer's, else null. */
export function topicMove(turn: WhoseTurn): TopicMove | null {
  return turn.kind === 'you' ? { move: turn.move, text: turn.what } : null;
}

/** One tile of the topic, as far as urgency cares. */
export interface UrgencyTile {
  state: TileStateKind;
  /** States of the tile's PRs outside quiet repos (all of them when none is quiet). */
  prStates: PrState[];
  /** The viewer's move when whose turn says it is theirs, else null. `merge` only makes a topic urgent with more to do. */
  move: TopicMove | null;
  /** Every PR of the tile is in a quiet repo ("Let it go stale"): it never makes the topic urgent. */
  quiet: boolean;
}

export interface TopicUrgency {
  /** Unread tiles, open or not. The tiles still show each one as unread. */
  unreadTiles: number;
  /** Unread tiles with at least one open PR. These light up the topic. */
  urgentUnreadTiles: number;
  /**
   * The moves on live (not done, not snoozed) tiles where it is the
   * viewer's move, merging an approved PR included; most urgent first
   * (`YOUR_MOVE_ORDER`), tile order on a tie. Its length is the chip's count.
   */
  yourMoves: TopicMove[];
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

function byMoveUrgency(a: TopicMove, b: TopicMove): number {
  return YOUR_MOVE_ORDER.indexOf(a.move) - YOUR_MOVE_ORDER.indexOf(b.move);
}

export function topicUrgency(tiles: UrgencyTile[]): TopicUrgency {
  const unreadTiles = tiles.filter((tile) => tile.state === 'unread').length;
  const urgentUnreadTiles = tiles.filter(isUrgentUnread).length;
  const live = tiles.filter((tile) => tile.state !== 'done' && tile.state !== 'snoozed');
  const yourMoves = live.flatMap((tile) => (tile.move === null ? [] : [tile.move])).toSorted(byMoveUrgency);
  const urgentMoves = live.filter((tile) => tile.move !== null && tile.move.move !== 'merge' && !tile.quiet).length;
  return { unreadTiles, urgentUnreadTiles, yourMoves, needsYou: urgentUnreadTiles > 0 || urgentMoves > 0 };
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

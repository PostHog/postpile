// When a topic counts as "needs you" in the sidebar: prominent coral unread,
// placed on top. Unread alone is not enough: a topic whose unread tiles are
// all merged or closed only has news to read, nothing to act on.
import type { PrState, TileStateKind } from './types.ts';

/** One tile of the topic, as far as urgency cares. */
export interface UrgencyTile {
  state: TileStateKind;
  /** States of the tile's PRs. */
  prStates: PrState[];
  /** Whose turn says it is the viewer's move. */
  yourMove: boolean;
}

export interface TopicUrgency {
  /** Unread tiles, open or not. The tiles still show each one as unread. */
  unreadTiles: number;
  /** Unread tiles with at least one open PR. These light up the topic. */
  urgentUnreadTiles: number;
  /** Live (not done) tiles where it is the viewer's move. */
  yourMoveTiles: number;
  /** An unread tile is still open, or it is the viewer's move somewhere. */
  needsYou: boolean;
}

export function isUrgentUnread(tile: UrgencyTile): boolean {
  return tile.state === 'unread' && tile.prStates.includes('OPEN');
}

export function topicUrgency(tiles: UrgencyTile[]): TopicUrgency {
  const unreadTiles = tiles.filter((tile) => tile.state === 'unread').length;
  const urgentUnreadTiles = tiles.filter(isUrgentUnread).length;
  const yourMoveTiles = tiles.filter((tile) => tile.state !== 'done' && tile.yourMove).length;
  return { unreadTiles, urgentUnreadTiles, yourMoveTiles, needsYou: urgentUnreadTiles > 0 || yourMoveTiles > 0 };
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

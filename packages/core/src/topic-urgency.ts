// When a topic counts as "needs you" in the sidebar: prominent coral unread,
// placed on top. Unread alone is not enough: a topic whose unread tiles are
// all merged or closed only has news to read, nothing to act on, and a tile
// unread with only quiet news (DESIGN.md "GitHub unread is PostPile unread")
// counts but never lights the topic up: urgency follows loud news.
import { ASK_TIERS, type PrTier } from './pr-tier.ts';
import { tileGroup, type TileGroup } from './tile-groups.ts';
import type { PrSummary, TileView } from './views.ts';
import type { IsoTime, PrKey, PrState, TileStateKind } from './types.ts';
import { YOUR_MOVE_ORDER, type WhoseTurn, type YourMove } from './whose-turn.ts';

/** The viewer's move on one tile, for the sidebar row's chip: its kind and the tile footer's words. */
export interface TopicMove {
  move: YourMove;
  /** The tile's `turn.what`, "Review, rowan asked". */
  text: string;
  /** The turn's `since`, for the row's "waiting on you" marker (`topicWaitDays`). Absent when the turn has none. */
  since?: IsoTime;
}

/** The tile's move when whose turn says it is the viewer's, else null. */
export function topicMove(turn: WhoseTurn): TopicMove | null {
  if (turn.kind !== 'you') {
    return null;
  }
  return turn.since === undefined ? { move: turn.move, text: turn.what } : { move: turn.move, text: turn.what, since: turn.since };
}

/** One tile of the topic, as far as urgency cares. */
export interface UrgencyTile {
  state: TileStateKind;
  /** A tracked thread is unread on GitHub (`TileState.unreadOnGitHub`), snoozed or not. */
  unreadOnGitHub: boolean;
  /** Unseen loud news on the tile (`TileState.loud`). */
  loud: boolean;
  /** PRs of the tile that are unread (`TileView.unreadPrKeys`). */
  unreadPrKeys: PrKey[];
  /** States of the tile's PRs outside quiet repos (all of them when none is quiet). */
  prStates: PrState[];
  /** The viewer's move when whose turn says it is theirs, else null. `merge` only makes a topic urgent with more to do. */
  move: TopicMove | null;
  /** The tier of the PR the move is about (`WhoseTurn.prKey`), 'rest' without a move: the chip orders moves like the sections. */
  moveTier: PrTier;
  /** Every PR of the tile is in a quiet repo ("Let it go stale"): it never makes the topic urgent. */
  quiet: boolean;
}

export interface TopicUrgency {
  /** Tiles in the Unread group (`tileGroup`): unread ones and snoozed ones with a thread unread on GitHub. */
  unreadTiles: number;
  /** Distinct unread PRs across the tiles (a PR in two set tiles counts once): the sidebar bubble's number. */
  unreadPrs: number;
  unreadPrKeys: PrKey[];
  /** Unread tiles with loud news and at least one open PR or a reply move (`isUrgentUnread`). These light up the topic. */
  urgentUnreadTiles: number;
  /**
   * The moves on live (not done, not snoozed) tiles where it is the
   * viewer's move, merging an approved PR included; most urgent first: by
   * the ask tier of the move's PR, in section order (`ASK_TIERS`, any other
   * tier after them), then `YOUR_MOVE_ORDER`, tile order on a tie. So the
   * chip leads with the move that put the topic in its section
   * (2026-10-11). Its length is the chip's count.
   */
  yourMoves: TopicMove[];
  /**
   * An unread tile is still open, or it is the viewer's move on a live tile
   * and that move is more than merging their own approved PR. Quiet and
   * snoozed tiles never count as a move.
   */
  needsYou: boolean;
}

/**
 * Unread with loud news and still something to act on: an open PR, or a
 * question to answer after the merge (the `reply` move, `askAfterMerge`;
 * coral since 2026-10-26, owner).
 */
export function isUrgentUnread(tile: UrgencyTile): boolean {
  if (tile.quiet || tile.state !== 'unread' || !tile.loud) {
    return false;
  }
  return tile.prStates.includes('OPEN') || tile.move?.move === 'reply';
}

/** Where a tier sorts among the asks: its section's place, every tier that asks nothing after them. */
function askRank(tier: PrTier): number {
  const rank = (ASK_TIERS as readonly PrTier[]).indexOf(tier);
  return rank === -1 ? ASK_TIERS.length : rank;
}

/** A move with the tier of its PR, for sorting. */
interface TieredMove {
  move: TopicMove;
  tier: PrTier;
}

function byMoveUrgency(a: TieredMove, b: TieredMove): number {
  return askRank(a.tier) - askRank(b.tier) || YOUR_MOVE_ORDER.indexOf(a.move.move) - YOUR_MOVE_ORDER.indexOf(b.move.move);
}

/** A tile counts for your move only while live: not done, not snoozed. */
function isLive(tile: Pick<UrgencyTile, 'state'>): boolean {
  return tile.state !== 'done' && tile.state !== 'snoozed';
}

/** The part of a built tile (`TileView`) that urgency reads. */
export type UrgencyView = Pick<TileView, 'state' | 'unreadPrKeys' | 'turn' | 'quietRepo'> & { prs: Pick<PrSummary, 'key' | 'state' | 'quietRepo' | 'tier'>[] };

/** The tier of the row the tile's move is about; 'rest' when the move names no row of the tile. */
function moveTierOf(view: UrgencyView): PrTier {
  return view.prs.find((pr) => pr.key === view.turn.prKey)?.tier ?? 'rest';
}

/** The urgency input of a built tile, so a topic's detail uses the same rule as its sidebar row. */
export function urgencyTileOf(view: UrgencyView): UrgencyTile {
  return {
    state: view.state.kind,
    unreadOnGitHub: view.state.unreadOnGitHub,
    loud: view.state.loud,
    unreadPrKeys: view.unreadPrKeys,
    prStates: view.prs.filter((pr) => !pr.quietRepo).map((pr) => pr.state),
    move: topicMove(view.turn),
    moveTier: moveTierOf(view),
    quiet: view.quietRepo,
  };
}

/** The topic header's chip: the same live moves as the sidebar row, most urgent first. */
export function topicYourMoves(views: UrgencyView[]): TopicMove[] {
  return topicUrgency(views.map(urgencyTileOf)).yourMoves;
}

/** Live tiles where it is your move, per group, for the group headings ("Open 4 · 2 your move"). Every group is present. */
export function yourMovesByGroup(views: (UrgencyView & Pick<TileView, 'group'>)[]): Record<TileGroup, number> {
  const counts: Record<TileGroup, number> = { unread: 0, open: 0, dealt_with: 0 };
  for (const view of views) {
    const tile = urgencyTileOf(view);
    if (isLive(tile) && tile.move !== null) {
      counts[view.group] += 1;
    }
  }
  return counts;
}

export function topicUrgency(tiles: UrgencyTile[]): TopicUrgency {
  const unreadTiles = tiles.filter((tile) => tileGroup({ kind: tile.state, unreadOnGitHub: tile.unreadOnGitHub }) === 'unread').length;
  const unreadPrKeys = [...new Set(tiles.flatMap((tile) => tile.unreadPrKeys))];
  const urgentUnreadTiles = tiles.filter(isUrgentUnread).length;
  const live = tiles.filter(isLive);
  const tiered = live.flatMap((tile) => (tile.move === null ? [] : [{ move: tile.move, tier: tile.moveTier }]));
  const yourMoves = tiered.toSorted(byMoveUrgency).map((entry) => entry.move);
  const urgentMoves = live.filter((tile) => tile.move !== null && tile.move.move !== 'merge' && !tile.quiet).length;
  return { unreadTiles, unreadPrs: unreadPrKeys.length, unreadPrKeys, urgentUnreadTiles, yourMoves, needsYou: urgentUnreadTiles > 0 || urgentMoves > 0 };
}

// What an outside agent needs to clear the user's inbox through MCP
// (DESIGN.md "MCP server" › whats_on_me): the app's own totals, which unread
// tiles have nothing left to do, which PR of a tile owns the move, and what
// clears a move. Marking read clears the unread, never a move or an ask.
import { ASK_TIERS, type PrTier } from './pr-tier.ts';
import type { PrKey, PrState } from './types.ts';
import type { PrSummary, TileView, TopicListItem } from './views.ts';
import type { YourMove } from './whose-turn.ts';

export interface InboxTotals {
  /** Tiles in the Unread group, snoozed ones with an unread thread too: the footer's number. */
  unreadTiles: number;
  /** Distinct unread PRs (a PR in two topics counts once): the PRs with the unread dot. */
  unreadPrs: number;
  /** Live tiles where it is the user's move: the sidebar chips' counts added up. */
  yourMoveTiles: number;
}

/** The app's totals over its sidebar rows, each from `topicUrgency`, so an agent sees the numbers the user sees. */
export function inboxTotals(items: Pick<TopicListItem, 'unreadTiles' | 'unreadPrKeys' | 'yourMoves'>[]): InboxTotals {
  const unreadPrKeys = new Set(items.flatMap((item) => item.unreadPrKeys));
  let unreadTiles = 0;
  let yourMoveTiles = 0;
  for (const item of items) {
    unreadTiles += item.unreadTiles;
    yourMoveTiles += item.yourMoves.length;
  }
  return { unreadTiles, unreadPrs: unreadPrKeys.size, yourMoveTiles };
}

function isAskTier(tier: PrTier): boolean {
  return (ASK_TIERS as readonly PrTier[]).includes(tier);
}

/** The part of a tile that the coverage rules read. */
export type CoverageView = Pick<TileView, 'group' | 'turn' | 'unreadPrKeys'> & { prs: Pick<PrSummary, 'key' | 'state' | 'tier'>[] };

/**
 * An unread tile with nothing left to do: every PR merged or closed, none
 * asks anything (no ask tier, so no reply owed after the merge) and it is
 * not the user's move. Marking it read is all it needs.
 */
export function isUnreadNothingToDo(view: CoverageView): boolean {
  if (view.group !== 'unread' || view.turn.kind === 'you') {
    return false;
  }
  return view.prs.every((pr) => pr.state !== 'OPEN' && !isAskTier(pr.tier));
}

/**
 * What clears a move. Marking read does not: a review request or a
 * personal ask stays until it is answered on GitHub. A team mention is the
 * one ask that clears on read (`WhoseTurn.teamAsk`).
 */
const MOVE_CLEARS: Record<YourMove, string> = {
  reply: 'reply on GitHub; mark_read does not',
  re_review: 're-review on GitHub; mark_read does not',
  review: 'review, or remove the request on GitHub; mark_read does not',
  address_changes: 'push fixes or answer the threads on GitHub; mark_read does not',
  merge: 'merge, or re-submit to the merge queue, on GitHub; mark_read does not',
};

/** What clears an unread tile that is not the user's move. */
export const READ_CLEARS = 'mark_read with the seen_through from pr_context';

/** A team mention asks only until it is read. */
const TEAM_ASK_CLEARS = 'mark_read with the seen_through from pr_context (a team mention asks only until read)';

/** "review, or remove the request on GitHub; mark_read does not": what clears the tile's row. */
export function rowClears(view: Pick<TileView, 'turn'>): string {
  if (view.turn.kind !== 'you') {
    return READ_CLEARS;
  }
  if (view.turn.teamAsk) {
    return TEAM_ASK_CLEARS;
  }
  return MOVE_CLEARS[view.turn.move];
}

/** The move as a word, for a PR line ("owns the move: re-review"). */
export const MOVE_WORDS: Record<YourMove, string> = {
  reply: 'reply',
  re_review: 're-review',
  review: 'review',
  address_changes: 'address changes',
  merge: 'merge',
};

/** One PR's place in its tile: unread, the PR the user's move is about, a merged or closed layer kept for context. */
export interface PrMarks {
  unread: boolean;
  /** The user's move when the tile's turn names this PR (`WhoseTurn.prKey`), else null. */
  ownsMove: YourMove | null;
  /** merged or closed: a layer kept for context, nothing to act on. Null on an open PR. */
  contextLayer: 'merged' | 'closed' | null;
}

function contextLayerOf(state: PrState): PrMarks['contextLayer'] {
  if (state === 'MERGED') {
    return 'merged';
  }
  return state === 'CLOSED' ? 'closed' : null;
}

export function prMarks(view: Pick<TileView, 'turn' | 'unreadPrKeys'>, pr: { key: PrKey; state: PrState }): PrMarks {
  const ownsMove = view.turn.kind === 'you' && view.turn.prKey === pr.key ? view.turn.move : null;
  return { unread: view.unreadPrKeys.includes(pr.key), ownsMove, contextLayer: contextLayerOf(pr.state) };
}

/** "context layer (merged), unread": the marks as words, empty when there are none. */
export function prMarksText(marks: PrMarks): string {
  const words: string[] = [];
  if (marks.contextLayer !== null) {
    words.push(`context layer (${marks.contextLayer})`);
  }
  if (marks.unread) {
    words.push('unread');
  }
  if (marks.ownsMove !== null) {
    words.push(`owns the move: ${MOVE_WORDS[marks.ownsMove]}`);
  }
  return words.join(', ');
}

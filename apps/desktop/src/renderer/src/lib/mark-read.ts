// The toast after a mark-read, from what core says the mark-read leaves
// (`TileView.afterRead`). What the buttons say and which one leads come from
// core too (`TileView.offers`); the renderer only displays them.
import type { TileAfterRead } from '@postpile/core';

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// "pim addressed your changes: re-review" (" on #12" on multi-PR tiles).
const RE_REVIEW = /: (re-review(?: on #\d+)?)$/;

// ", lyra mentioned you" at the end of a move.
const MENTION_TAIL = /, \S+ mentioned you$/;

/** The move in toast words: "re-review", "answer ada's question". */
export function moveWords(what: string): string {
  const reReview = RE_REVIEW.exec(what);
  // The mention is seen once the thread is read, so the tail would only repeat news.
  return reReview ? reReview[1]! : lowerFirst(what).replace(MENTION_TAIL, '');
}

export interface MarkReadNoticeInput {
  /** The engine's message ("marked 3 events read"). */
  message: string;
  ok: boolean;
  /** GitHub writes are on: the app changed right away. Locked, nothing changed here yet. */
  writesOn: boolean;
  /** What the tile would be after the mark-read, from before it. */
  afterRead: TileAfterRead;
  /** Set when one PR of the tile was marked (the pane): the toast names it. */
  prKey?: string;
}

export interface MarkReadNotice {
  message: string;
  /** Show a Snooze action in the toast. */
  offerSnooze: boolean;
}

/**
 * After a mark-read that leaves the tile your move, the toast says so and
 * offers Snooze: "Marked read. Still your move: re-review." Otherwise the
 * engine's message stays.
 */
export function markReadNotice(input: MarkReadNoticeInput): MarkReadNotice {
  const turn = input.afterRead.turn;
  if (!input.ok || !input.writesOn || input.afterRead.done || turn.kind !== 'you') {
    return { message: input.message, offerSnooze: false };
  }
  const marked = input.prKey ? `#${input.prKey.split('#')[1] ?? input.prKey} ` : '';
  return { message: `Marked ${marked}read. Still your move: ${moveWords(turn.what)}.`, offerSnooze: true };
}

/**
 * The toast after a snooze: the tile is quiet in PostPile but the thread
 * stays unread on GitHub (GitHub unread is PostPile unread), so say so.
 */
export function snoozeMessage(message: string, ok: boolean): string {
  return ok ? `${message.replace(/\.$/, '')}. Still unread on GitHub.` : message;
}

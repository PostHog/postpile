// The toast after a mark-read, from what core says the mark-read leaves
// (`TileView.afterRead`). What the buttons say and which one leads come from
// core too (`TileView.offers`); the renderer only displays them.
import type { TileAfterRead } from '@postpile/core';

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// "pim addressed your changes: re-review" (" on #12" on multi-PR tiles).
const RE_REVIEW = /: (re-review(?: on #\d+)?)$/;

/** The move in toast words: "re-review", "answer ada's question". */
export function moveWords(what: string): string {
  const reReview = RE_REVIEW.exec(what);
  return reReview ? reReview[1]! : lowerFirst(what);
}

export interface MarkReadNoticeInput {
  /** The engine's message ("marked 3 events read"). */
  message: string;
  ok: boolean;
  /** GitHub writes are on: the app changed right away. Locked, nothing changed here yet. */
  writesOn: boolean;
  /** What the tile would be after the mark-read, from before it. */
  afterRead: TileAfterRead;
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
  return { message: `Marked read. Still your move: ${moveWords(turn.what)}.`, offerSnooze: true };
}

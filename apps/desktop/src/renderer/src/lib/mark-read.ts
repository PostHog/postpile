// What the tile's mark button says and what takes its place, so the label
// never promises more than a mark-read does (2026-09-29). Core's
// `TileView.afterRead` says what a mark-read would leave behind.
import type { PrPrimaryAction, PrSummary, TileAfterRead, TileView } from '@postpile/core';
import { filesTabUrl } from './key-files.ts';
import { leadPr } from './tiles.ts';

/**
 * The tile footer's main action:
 * - open: the tile is done, the button opens it.
 * - mark_read: "Mark read". The tile is unread, or a mark-read leaves something asked.
 * - mark_done: "Mark done". The tile is read and a mark-read makes it done.
 * - snooze: the tile is read and still your move. Marking read changes
 *   nothing you can see, so Snooze is the primary button and "Review on
 *   GitHub" sits next to it.
 */
export type TileFooterAction = 'open' | 'mark_read' | 'mark_done' | 'snooze';

export function tileFooterAction(view: Pick<TileView, 'state' | 'turn' | 'afterRead'>): TileFooterAction {
  if (view.state.kind === 'done') {
    return 'open';
  }
  if (view.state.kind === 'unread') {
    return 'mark_read';
  }
  if (view.state.kind === 'open' && view.turn.kind === 'you') {
    return 'snooze';
  }
  return view.afterRead.done ? 'mark_done' : 'mark_read';
}

/** The mark button's label, or null when the tile shows none (read and still your move). Done tiles keep "Mark read". */
export function markButtonLabel(view: Pick<TileView, 'state' | 'turn' | 'afterRead'>): 'Mark read' | 'Mark done' | null {
  const action = tileFooterAction(view);
  if (action === 'snooze') {
    return null;
  }
  return action === 'mark_done' ? 'Mark done' : 'Mark read';
}

/**
 * The detail pane's one ink button, so the pane leads with what the tile
 * leads with (2026-09-29):
 * - approve: Approve is due (someone else's open PR, not approved yet, not a
 *   draft). The pane is where approving happens, so it keeps the lead.
 * - mark_read / mark_done / snooze: the tile's footer action.
 * - open_on_github: the tile is done (its footer "Open" means nothing in the
 *   pane, which already shows it).
 * "Approve again" and "Approve draft" stay outlined, and the tile's action
 * leads next to them; before, an approved PR had no primary at all.
 */
export type DetailPrimary = 'approve' | 'mark_read' | 'mark_done' | 'snooze' | 'open_on_github';

export interface DetailPrimaryInput {
  view: Pick<TileView, 'state' | 'turn' | 'afterRead'>;
  /** Core's primary action for the PR (`PrSummary.primaryAction`). */
  prAction: PrPrimaryAction;
  /** The Approve button's look (`approveButton`): outlined for "Approve again" and "Approve draft". */
  approveVariant: 'primary' | 'secondary';
}

export function detailPrimary(input: DetailPrimaryInput): DetailPrimary {
  if (input.prAction === 'approve' && input.approveVariant === 'primary') {
    return 'approve';
  }
  const footer = tileFooterAction(input.view);
  return footer === 'open' ? 'open_on_github' : footer;
}

export interface GitHubLink {
  label: string;
  href: string;
}

/** The PR the move is about, else the lead PR. */
function movePr(view: TileView): PrSummary | null {
  return view.prs.find((pr) => pr.key === view.turn.prKey) ?? leadPr(view);
}

/**
 * The quieter button next to Snooze: "Review on GitHub" opens the files tab
 * of someone else's PR; on your own PR (address changes, merge) it is
 * "Open on GitHub" and opens the PR.
 */
export function githubLink(view: TileView): GitHubLink | null {
  const pr = movePr(view);
  if (!pr || !pr.url) {
    return null;
  }
  if (pr.authorRelation === 'you') {
    return { label: 'Open on GitHub', href: pr.url };
  }
  return { label: 'Review on GitHub', href: filesTabUrl(pr.url) };
}

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

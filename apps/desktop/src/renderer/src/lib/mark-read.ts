// The toast after a mark-read, from what core says the mark-read leaves
// (`TileView.afterRead`). What the buttons say and which one leads come from
// core too (`TileView.offers`); the renderer only displays them.
import type { ActionResult, AgentReadNotice, TileAfterRead } from '@postpile/core';
import { clientDisplayName } from './proposals.ts';
import { prNumber } from './tiles.ts';

// Undo tokens of purely local choices, matching the engine's prefixes: memory
// corrections, Inbox declines, removed rules and tailoring lines. Their undo
// windows never end in a GitHub write.
const LOCAL_UNDO_PREFIXES = ['memory:', 'proposal:', 'rule:', 'tailoring:'];

/** True when an undo token belongs to a mark-read waiting to reach GitHub. */
export function isMarkReadUndoToken(token: string): boolean {
  return !LOCAL_UNDO_PREFIXES.some((prefix) => token.startsWith(prefix));
}

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
 * The toast after a snooze. Snoozing is local, so an unread tile stays unread
 * on GitHub (GitHub unread is PostPile unread) and the toast says so. A tile
 * that was already read says nothing about GitHub: the snooze changed nothing there.
 */
export function snoozeMessage(message: string, ok: boolean, unreadOnGitHub: boolean): string {
  return ok && unreadOnGitHub ? `${message.replace(/\.$/, '')}. Still unread on GitHub.` : message;
}

/**
 * The toast for an outside agent's mark_read (DESIGN.md "Agents mark read"):
 * "Claude Code marked #1902 and #1911 read", and while GitHub writes are
 * locked that it waits for them. The toast offers Undo like a button's.
 */
export function agentReadText(notice: Pick<AgentReadNotice, 'client' | 'prKeys' | 'writesLocked'>): string {
  const numbers = notice.prKeys.map((key) => `#${prNumber(key)}`);
  const last = numbers.pop();
  const prs = numbers.length === 0 ? (last ?? '') : `${numbers.join(', ')} and ${last}`;
  const base = `${clientDisplayName(notice.client)} marked ${prs} read`;
  return notice.writesLocked ? `${base}: pending until you unlock GitHub writes, stays unread here until then` : base;
}

export interface AgentReadsToast {
  message: string;
  /** The batches that can still be undone, each with its own window end: the provider refetches after each, so a locked batch shows as pending once it parked. */
  batches: { token: string; until: number }[];
  /** When the first of their undo windows ends: the toast's Undo, which takes them all back, goes then. Null when none can be undone. */
  undoUntil: number | null;
}

/**
 * One toast for the agent mark-reads newer than the last one this window
 * showed, oldest first; null when there are none. Two calls between two
 * polls share the toast, and its Undo takes back every batch that can
 * still be undone. A window that was minimised past the undo window still
 * says what was marked, without Undo.
 */
export function agentReadsToast(notices: AgentReadNotice[], seenId: number, now: number): AgentReadsToast | null {
  const fresh = notices.filter((notice) => notice.id > seenId);
  if (fresh.length === 0) {
    return null;
  }
  const batches = fresh
    .filter((notice) => notice.undoable && Date.parse(notice.undoUntil) > now)
    .map((notice) => ({ token: notice.undoToken, until: Date.parse(notice.undoUntil) }));
  return {
    message: fresh.map(agentReadText).join('; '),
    batches,
    undoUntil: batches.length === 0 ? null : Math.min(...batches.map((batch) => batch.until)),
  };
}

/** One result for several undos sent together: the first failure, else the first answer. */
export function combinedUndoResult(results: ActionResult[]): ActionResult {
  return results.find((result) => !result.ok) ?? results[0] ?? { ok: false, message: 'Nothing to undo', undoToken: null };
}

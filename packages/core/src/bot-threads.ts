// Replies in review threads, and the quiet case: a person answering a bot.
// A review bot (greptile, coderabbit, ...) opens inline threads and the
// author answers each one ("fixed", "not an issue"). Those replies are
// housekeeping with a bot, not news for the viewer: quiet by rule, one line
// per thread in the PR pane's activity list, and ranked below people's
// comments in the tile's headline. A reply that mentions, asks or answers the
// viewer is an ask (events.ts `addressedKind`) and never counts here.
// DESIGN.md "The PR pane" › Thread context and replies to bots.
import { isMachineComment } from './bots.ts';
import { carriedReplies } from './carrier-reviews.ts';
import { sameLogin } from './mentions.ts';
import type { Comment, EventKind, Pr, PrEvent, Review, ReviewThread } from './types.ts';

/** Where a thread reply sits: whom it answers and the file. */
export interface ThreadReply {
  threadId: string;
  /** Who it answers: the last other person before it, or the first one when only bots spoke (a bot thread). */
  to: string;
  path: string;
}

function threadOf(comment: Comment, pr: Pr): ReviewThread | null {
  if (comment.threadId === null) {
    return null;
  }
  return pr.threads.find((thread) => thread.id === comment.threadId) ?? null;
}

/** The thread's comments before this one, written by someone else. */
function othersBefore(comment: Comment, thread: ReviewThread): Comment[] {
  const index = thread.comments.findIndex((candidate) => candidate.id === comment.id);
  const before = index === -1 ? [] : thread.comments.slice(0, index);
  return before.filter((earlier) => !sameLogin(earlier.author, comment.author));
}

/**
 * Whom a comment in a review thread answers, and on which file: the last
 * other person who spoke before it ("bob replied to alice"), or the first
 * one when everyone else was a bot ("bob replied to greptile-apps[bot]").
 * Null for a comment outside a thread and for a thread's opener (nobody else
 * spoke before it).
 */
export function threadReplyOf(comment: Comment, pr: Pr): ThreadReply | null {
  const thread = threadOf(comment, pr);
  if (thread === null) {
    return null;
  }
  const others = othersBefore(comment, thread);
  const first = others[0];
  if (first === undefined) {
    return null;
  }
  const people = others.filter((earlier) => !isMachineComment(earlier));
  const to = people[people.length - 1] ?? first;
  return { threadId: thread.id, to: to.author, path: thread.path };
}

/**
 * A person's reply in a bot conversation: the comment sits in a review
 * thread, someone else spoke there before it, and every one of them was a
 * bot (`isMachineComment`). Judged at the reply, from what came before it:
 * a person who joins later makes their own reply a normal one and leaves the
 * earlier ones quiet, so nothing turns loud after the fact.
 */
export function isBotThreadReply(comment: Comment, pr: Pr): boolean {
  if (isMachineComment(comment)) {
    return false;
  }
  const thread = threadOf(comment, pr);
  if (thread === null) {
    return false;
  }
  const others = othersBefore(comment, thread);
  return others.length > 0 && others.every(isMachineComment);
}

/**
 * The bot-thread replies an empty review only carries (`carriedReplies`):
 * GitHub makes one review (COMMENTED, no body) per thread reply, so without
 * this every "fixed" to a bot would also show as "alice reviewed". Empty
 * unless every reply it carries is a bot-thread reply.
 */
export function carriedBotThreadReplies(review: Review, pr: Pr): Comment[] {
  const carried = carriedReplies(review, pr);
  return carried.length > 0 && carried.every((comment) => isBotThreadReply(comment, pr)) ? carried : [];
}

/** Event kinds that can belong to a person's reply in a bot thread. */
const BOT_THREAD_KINDS: readonly EventKind[] = ['comment', 'comment_edited', 'review_commented'];

/**
 * The bot thread an event is part of: a person's reply there (`comment`),
 * an edit of that reply, or the empty review GitHub made to carry it. Null
 * for every other event, an ask among them (a mention, question or reply to
 * the viewer has its own kind).
 */
export function botThreadOf(event: Pick<PrEvent, 'kind' | 'sourceId'>, pr: Pr): string | null {
  if (!BOT_THREAD_KINDS.includes(event.kind)) {
    return null;
  }
  if (event.kind === 'review_commented') {
    const review = pr.reviews.find((candidate) => candidate.id === event.sourceId);
    const carried = review ? carriedBotThreadReplies(review, pr) : [];
    return carried[0]?.threadId ?? null;
  }
  const comment = pr.comments.find((candidate) => candidate.id === event.sourceId);
  return comment !== undefined && isBotThreadReply(comment, pr) ? comment.threadId : null;
}

import { isMachineComment } from './bots.ts';
import { mentionsUser } from './mentions.ts';
import type { Comment, Pr, Review } from './types.ts';

/** How much of the replied-to comment the quote keeps. */
export const REPLY_QUOTE_MAX = 200;

/** Comments of the conversation around a reply target the agent sees before and after it. */
const CONVERSATION_BEFORE = 8;
const CONVERSATION_AFTER = 4;

/** Where a reply to a comment goes: its inline review thread, or a new PR comment that quotes it. */
export type ReplyTarget = { kind: 'thread'; threadId: string } | { kind: 'comment' };

export function replyTarget(comment: Comment): ReplyTarget {
  if (comment.kind === 'review_comment' && comment.threadId !== null) {
    return { kind: 'thread', threadId: comment.threadId };
  }
  return { kind: 'comment' };
}

/**
 * The first line of the comment worth quoting: not empty, not itself a quote.
 * Falls back to the first non-empty line with its quote marks taken off.
 */
function firstQuotableLine(body: string): string {
  const lines = body.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  const own = lines.find((line) => !line.startsWith('>'));
  if (own !== undefined) {
    return own;
  }
  return (lines[0] ?? '').replace(/^>+\s*/, '');
}

function clipLine(line: string, max: number): string {
  return line.length <= max ? line : `${line.slice(0, max).trimEnd()}...`;
}

/**
 * The body of a reply to an issue comment or review body, posted as a new PR
 * comment: GitHub has no threads there, so it quotes the first line of the
 * comment and mentions its author, unless the user's text already does.
 */
export function quotedReplyBody(comment: Pick<Comment, 'author' | 'body'>, text: string): string {
  const reply = text.trim();
  const addressed = mentionsUser(reply, comment.author) ? reply : `@${comment.author} ${reply}`;
  const quote = clipLine(firstQuotableLine(comment.body), REPLY_QUOTE_MAX);
  return quote === '' ? addressed : `> ${quote}\n\n${addressed}`;
}

export function findComment(pr: Pr, commentId: string): Comment | null {
  return pr.comments.find((comment) => comment.id === commentId) ?? null;
}

/**
 * What a thumbs up can go on: a comment (issue comment, review body, inline
 * comment) or a review. An approval without a body is no comment, but still
 * a review node GitHub takes a reaction on.
 */
export function findReactable(pr: Pr, id: string): Comment | Review | null {
  return findComment(pr, id) ?? pr.reviews.find((review) => review.id === id) ?? null;
}

/** The PR with the viewer's thumbs up on comment or review `id`, everywhere it shows: comments, reviews and thread comments. */
export function withViewerReaction(pr: Pr, id: string): Pr {
  const mark = <T extends { id: string }>(item: T): T => (item.id === id ? { ...item, viewerReacted: true } : item);
  return {
    ...pr,
    comments: pr.comments.map(mark),
    reviews: pr.reviews.map(mark),
    threads: pr.threads.map((thread) => ({ ...thread, comments: thread.comments.map(mark) })),
  };
}

/**
 * What the agent reads besides the comment when drafting a reply, oldest
 * first and including the comment: its whole review thread for an inline
 * comment, else the human conversation around it (a few before, a few after).
 */
export function replyConversation(pr: Pr, comment: Comment): Comment[] {
  const target = replyTarget(comment);
  if (target.kind === 'thread') {
    const thread = pr.threads.find((candidate) => candidate.id === target.threadId);
    return thread ? thread.comments : [comment];
  }
  const conversation = pr.comments.filter((candidate) => candidate.kind !== 'review_comment' && (candidate.id === comment.id || !isMachineComment(candidate)));
  const at = conversation.findIndex((candidate) => candidate.id === comment.id);
  if (at === -1) {
    return [comment];
  }
  return conversation.slice(Math.max(0, at - CONVERSATION_BEFORE), at + CONVERSATION_AFTER + 1);
}

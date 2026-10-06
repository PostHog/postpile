// The empty reviews GitHub makes for thread replies. Every inline comment
// belongs to a review on GitHub: a reply in a review thread gets a review of
// its own (COMMENTED, no body, the same second), which says nothing the
// reply does not. Such a "carrier" review never shows as its own "alice
// reviewed" line, in the activity list or the PR pane's Reviews list, and
// never counts as a review on your PR. DESIGN.md "The PR pane" › Thread
// context and replies to bots.
import { sameLogin } from './mentions.ts';
import type { Comment, Pr, PrEvent, Review } from './types.ts';

/**
 * How far apart a thread reply and the review GitHub made for it can be,
 * for comments that do not know their review (`Comment.reviewId`, missing
 * on snapshots stored before 0.22.0).
 */
const CARRIER_REVIEW_WINDOW_MS = 2_000;

/** The comment's thread, null outside a thread and when the snapshot does not hold the thread. */
function threadOf(comment: Comment, pr: Pr) {
  if (comment.threadId === null) {
    return null;
  }
  return pr.threads.find((thread) => thread.id === comment.threadId) ?? null;
}

/** The comment answers in a review thread: its thread has an earlier comment. */
export function isThreadReply(comment: Comment, pr: Pr): boolean {
  const thread = threadOf(comment, pr);
  return thread !== null && thread.comments.findIndex((candidate) => candidate.id === comment.id) > 0;
}

/** The comment opens its review thread. */
export function opensThread(comment: Comment, pr: Pr): boolean {
  const thread = threadOf(comment, pr);
  return thread !== null && thread.comments[0]?.id === comment.id;
}

/** The inline comments that name the review as theirs (`Comment.reviewId`). */
export function inlineCommentsOf(review: Review, pr: Pr): Comment[] {
  return pr.comments.filter((comment) => comment.reviewId === review.id);
}

/**
 * The inline comments submitted with a review: those that name it, else
 * (an older snapshot) the author's thread comments without a review id
 * posted the same second.
 */
export function commentsSentWith(review: Review, pr: Pr): Comment[] {
  const named = inlineCommentsOf(review, pr);
  if (named.length > 0) {
    return named;
  }
  const submitted = Date.parse(review.submittedAt);
  return pr.comments.filter(
    (comment) =>
      comment.threadId !== null &&
      comment.reviewId === undefined &&
      sameLogin(comment.author, review.author) &&
      Math.abs(Date.parse(comment.createdAt) - submitted) <= CARRIER_REVIEW_WINDOW_MS,
  );
}

/**
 * The thread replies an empty review only carries: a COMMENTED review
 * without a body whose every inline comment answers in an existing thread.
 * Empty for any other review: an approval, a changes request, a review with
 * text, or one whose comments start new threads is a real review.
 */
export function carriedReplies(review: Review, pr: Pr): Comment[] {
  if (review.state !== 'COMMENTED' || review.body.trim() !== '') {
    return [];
  }
  const sent = commentsSentWith(review, pr);
  return sent.length > 0 && sent.every((comment) => isThreadReply(comment, pr)) ? sent : [];
}

/** The review only carries thread replies (`carriedReplies`). */
export function isCarrierReview(review: Review, pr: Pr): boolean {
  return carriedReplies(review, pr).length > 0;
}

/** The event is a carrier review's review_commented event. */
export function isCarrierReviewEvent(event: Pick<PrEvent, 'kind' | 'sourceId'>, pr: Pr): boolean {
  if (event.kind !== 'review_commented') {
    return false;
  }
  const review = pr.reviews.find((candidate) => candidate.id === event.sourceId);
  return review !== undefined && isCarrierReview(review, pr);
}

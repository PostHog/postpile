// A review bot's review with its inline comments, folded. greptile or
// coderabbit submit one review that opens a thread per finding; each
// finding is its own bot comment, so one review read as seven bot events.
// The PR pane's activity list shows it as one quiet line instead,
// "greptile-apps[bot] reviewed · 6 inline comments", which opens to the
// file and first line of each comment. Matched by the comments' review id
// only (`Comment.reviewId`): older snapshots fold once they are refetched.
// DESIGN.md "The PR pane" › Thread context and replies to bots.
import { isBot } from './bots.ts';
import { inlineCommentsOf, opensThread } from './carrier-reviews.ts';
import { mentionsUser } from './mentions.ts';
import type { EventKind, FullComment, FullPr, FullReview, PrEvent, Viewer } from './types.ts';

function mentionsViewer(body: string, viewer: Viewer | null): boolean {
  return viewer !== null && mentionsUser(body, viewer.login);
}

/**
 * The inline comments a bot's review folds: a COMMENTED review by a bot
 * account whose inline comments (by review id, at least one) each open a
 * thread of their own. Empty when it does not fold: a person's review, an
 * approval or a changes request, a review whose comments answer in existing
 * threads, and one whose text or comments mention the viewer, which keeps
 * its normal line.
 */
export function foldedBotReviewComments(review: FullReview, pr: FullPr, viewer: Viewer | null): FullComment[] {
  if (review.author === '' || !isBot(review.author) || review.state !== 'COMMENTED' || mentionsViewer(review.body, viewer)) {
    return [];
  }
  const comments = inlineCommentsOf(review, pr);
  const folds = comments.length > 0 && comments.every((comment) => opensThread(comment, pr) && !mentionsViewer(comment.body, viewer));
  return folds ? comments : [];
}

/** Event kinds a bot review's fold can hold: the review, its comments (and its text as a comment) and their edits. */
const BOT_REVIEW_KINDS: readonly EventKind[] = ['review_commented', 'bot_comment', 'deploy', 'comment_edited'];

/** The review an event's source belongs to: the review itself, its text, or one of its inline comments. */
function reviewOfSource(sourceId: string, pr: FullPr): FullReview | null {
  const review = pr.reviews.find((candidate) => candidate.id === sourceId);
  if (review !== undefined) {
    return review;
  }
  const comment = pr.comments.find((candidate) => candidate.id === sourceId);
  const reviewId = comment?.reviewId;
  return reviewId === undefined ? null : (pr.reviews.find((candidate) => candidate.id === reviewId) ?? null);
}

/**
 * The folding bot review a bot's event is part of: the review, the comment
 * that holds its text (same id), one of its inline comments, or an edit of
 * one of them. Null for every other event, a person's among them.
 */
export function botReviewOf(event: Pick<PrEvent, 'kind' | 'sourceId' | 'isBot'>, pr: FullPr, viewer: Viewer | null): FullReview | null {
  if (!event.isBot || !BOT_REVIEW_KINDS.includes(event.kind)) {
    return null;
  }
  const review = reviewOfSource(event.sourceId, pr);
  return review !== null && foldedBotReviewComments(review, pr, viewer).length > 0 ? review : null;
}

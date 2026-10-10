// Changes to a sample PR the way GitHub would make them, so the snapshot the
// fake keeps looks like the one the real engine fetches after a write or a
// poll: a review lands in `reviews` (its body in `comments`), a comment in
// `comments`, and the review decision follows. The event for the change is
// derived by core's `deriveEvents`, the same rule the sync runs, so its kind
// and loudness are the real app's.
import { deriveEvents, sameLogin, type FullComment, type FullPr, type FullReview, type PrEvent, type ReviewDecision, type UserPrState, type Viewer } from '@postpile/core';

/**
 * Like GitHub with a review rule: each person's latest approval or changes
 * request stands (a dismissed review counts for nothing), and a standing
 * changes request wins. "NONE" (the repo has no review rule) stays.
 */
export function reviewDecisionOf(pr: FullPr): ReviewDecision {
  if (pr.reviewDecision === 'NONE') {
    return 'NONE';
  }
  const latest = new Map<string, FullReview>();
  for (const review of pr.reviews.toSorted((a, b) => a.submittedAt.localeCompare(b.submittedAt))) {
    if (review.state === 'APPROVED' || review.state === 'CHANGES_REQUESTED' || review.state === 'DISMISSED') {
      latest.set(review.author.toLowerCase(), review);
    }
  }
  const states = [...latest.values()].map((review) => review.state);
  if (states.includes('CHANGES_REQUESTED')) {
    return 'CHANGES_REQUESTED';
  }
  return states.includes('APPROVED') ? 'APPROVED' : 'REVIEW_REQUIRED';
}

/**
 * The PR with a new review, as GitHub shows it after: a body with text is
 * also a comment (like the reader adds review bodies), the reviewer's
 * pending personal request is gone, and the review decision is worked out again.
 */
export function withReview(pr: FullPr, review: FullReview): FullPr {
  const bodyComment: FullComment[] =
    review.body.trim() === ''
      ? []
      : [{ id: review.id, author: review.author, body: review.body, createdAt: review.submittedAt, kind: 'review', url: review.url ?? pr.url, path: null, threadId: null }];
  const changed: FullPr = {
    ...pr,
    reviews: [...pr.reviews, review],
    comments: [...pr.comments, ...bodyComment],
    reviewerUsers: pr.reviewerUsers.filter((login) => !sameLogin(login, review.author)),
  };
  return { ...changed, reviewDecision: reviewDecisionOf(changed) };
}

/** The PR with a new issue comment at the end of its comments. */
export function withComment(pr: FullPr, comment: FullComment): FullPr {
  return { ...pr, comments: [...pr.comments, comment] };
}

/**
 * The event the sync would derive from the PR for one source (a review,
 * comment, commit or timeline item id), with `seenAt` as given; null when
 * the rules derive none for it (an own review body, say).
 */
export function derivedEvent(pr: FullPr, viewer: Viewer, userState: UserPrState | null, sourceId: string, seenAt: string | null): PrEvent | null {
  const event = deriveEvents(pr, viewer, userState).find((candidate) => candidate.sourceId === sourceId && candidate.kind !== 'comment_edited');
  return event ? { ...event, seenAt } : null;
}

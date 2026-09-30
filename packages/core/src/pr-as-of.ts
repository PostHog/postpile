// A PR as it stood at an earlier time, as far as the snapshot can tell, so
// the quiet reads can ask whether the viewer's move is new since they last
// looked (DESIGN.md "Handled quietly" › New moves only, 2026-09-30). What was
// added after that time is taken out: reviews, comments, commits, timeline
// items, review requests, a switch to ready or to draft, the in-app approval.
// What was taken away after it is not put back (a removed request, a resolved
// thread): a move that only needed a blocker gone stood already, like "Merge,
// it is approved" after an approval before the read. Rules only, no IO.
import { sameLogin } from './mentions.ts';
import type { IsoTime, Pr, PrEvent, Review, ReviewDecision, ReviewThread, UserPrState } from './types.ts';

/**
 * A pending reviewer whose newest request came after `at` was not pending
 * then (asked, or asked again after reviewing); one asked before, or with no
 * request in the timeline, was.
 */
function pendingAt(pr: Pr, subjects: string[], at: IsoTime): string[] {
  return subjects.filter((subject) => {
    const requests = pr.timeline.filter((item) => item.kind === 'review_requested' && item.subject !== null && sameLogin(item.subject, subject));
    return requests.every((item) => item.at <= at);
  });
}

/** The first switch to ready or to draft after `at` says what the PR was before it. */
function draftAt(pr: Pr, at: IsoTime): boolean {
  const switches = pr.timeline
    .filter((item) => (item.kind === 'ready_for_review' || item.kind === 'converted_to_draft') && item.at > at)
    .toSorted((a, b) => a.at.localeCompare(b.at));
  const first = switches[0];
  return first === undefined ? pr.isDraft : first.kind === 'ready_for_review';
}

/** Like GitHub from the standing verdicts: a changes request wins, then an approval; a dismissed review counts for nothing. */
function decisionFrom(reviews: Review[]): ReviewDecision {
  const latest = new Map<string, Review>();
  for (const review of reviews.toSorted((a, b) => a.submittedAt.localeCompare(b.submittedAt))) {
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

/** GitHub's decision stays unless a review came after `at`; then it is worked out again ("NONE", no review rule, stays). */
function decisionAt(pr: Pr, reviews: Review[]): ReviewDecision {
  if (reviews.length === pr.reviews.length || pr.reviewDecision === 'NONE') {
    return pr.reviewDecision;
  }
  return decisionFrom(reviews);
}

function threadsAt(pr: Pr, at: IsoTime): ReviewThread[] {
  return pr.threads
    .map((thread) => ({ ...thread, comments: thread.comments.filter((comment) => comment.createdAt <= at) }))
    .filter((thread) => thread.comments.length > 0);
}

/** The PR at `at`: everything added after it taken out (see the file comment). State, CI and the rest stay as they are. */
export function prAsOf(pr: Pr, at: IsoTime): Pr {
  const reviews = pr.reviews.filter((review) => review.submittedAt <= at);
  const commits = pr.commits.filter((commit) => commit.committedAt <= at);
  return {
    ...pr,
    isDraft: draftAt(pr, at),
    reviewDecision: decisionAt(pr, reviews),
    reviewerUsers: pendingAt(pr, pr.reviewerUsers, at),
    reviewerTeams: pendingAt(pr, pr.reviewerTeams, at),
    reviews,
    commits,
    headOid: commits.at(-1)?.oid ?? pr.headOid,
    comments: pr.comments.filter((comment) => comment.createdAt <= at),
    threads: threadsAt(pr, at),
    timeline: pr.timeline.filter((item) => item.at <= at),
  };
}

/** The PR's events up to `at`. */
export function eventsAsOf(events: PrEvent[], at: IsoTime): PrEvent[] {
  return events.filter((event) => event.at <= at);
}

/** The in-app approval only when it came at or before `at`. */
export function userStateAsOf(userState: UserPrState | null, at: IsoTime): UserPrState | null {
  if (userState === null || userState.approvedAt === null || userState.approvedAt <= at) {
    return userState;
  }
  return { ...userState, approvedAt: null, approvedCommitOid: null };
}

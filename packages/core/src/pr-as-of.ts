// A PR as it stood at an earlier time, as far as the snapshot can tell, so
// the quiet reads can ask whether the viewer's move is new since they last
// looked (DESIGN.md "Handled quietly" › New moves only, 2026-09-30). Honest
// history: what happened after that time is undone. Reviews, comments,
// commits and timeline items after it are taken out; review requests asked
// after it are dropped and ones removed after it (by hand, or by the
// reviewer's review) put back; a switch to ready or draft and a merge, close
// or reopen after it are undone; the in-app approval after it is dropped.
// Only what the snapshot cannot tell stays as it is now (a thread resolved
// since, CI). Rules only, no IO.
import { sameLogin } from './mentions.ts';
import type { IsoTime, Pr, PrEvent, Review, ReviewDecision, ReviewThread, UserPrState } from './types.ts';

/** One change to the pending review requests: a request, a removal, or a sent review (GitHub drops the reviewer's request). */
interface RequestChange {
  at: IsoTime;
  subject: string;
  kind: 'asked' | 'removed' | 'reviewed';
}

function requestChanges(pr: Pr): RequestChange[] {
  const changes: RequestChange[] = [];
  for (const item of pr.timeline) {
    if (item.subject !== null && (item.kind === 'review_requested' || item.kind === 'review_request_removed')) {
      changes.push({ at: item.at, subject: item.subject, kind: item.kind === 'review_requested' ? 'asked' : 'removed' });
    }
  }
  for (const review of pr.reviews) {
    if (review.state !== 'PENDING') {
      changes.push({ at: review.submittedAt, subject: review.author, kind: 'reviewed' });
    }
  }
  return changes.toSorted((a, b) => a.at.localeCompare(b.at));
}

/** The subject had a request standing just before `before`: its newest change before then is a request. */
function askedBefore(changes: RequestChange[], subject: string, before: IsoTime): boolean {
  const earlier = changes.filter((change) => change.at < before && sameLogin(change.subject, subject));
  return earlier.at(-1)?.kind === 'asked';
}

function withoutSubject(subjects: string[], subject: string): string[] {
  return subjects.filter((candidate) => !sameLogin(candidate, subject));
}

/**
 * The pending review requests at `at`: the ones pending now with every
 * change after `at` undone, newest first. A request after it is dropped; a
 * removal after it, and a review after it that ended a standing request,
 * put the request back.
 */
function pendingAt(pr: Pr, at: IsoTime): { users: string[]; teams: string[] } {
  const changes = requestChanges(pr);
  let users = [...pr.reviewerUsers];
  let teams = [...pr.reviewerTeams];
  for (const change of changes.filter((candidate) => candidate.at > at).toReversed()) {
    const isTeam = change.subject.includes('/');
    if (change.kind === 'asked') {
      users = withoutSubject(users, change.subject);
      teams = withoutSubject(teams, change.subject);
      continue;
    }
    const putBack = change.kind === 'removed' || askedBefore(changes, change.subject, change.at);
    if (putBack && isTeam && !teams.some((team) => sameLogin(team, change.subject))) {
      teams.push(change.subject);
    }
    if (putBack && !isTeam && !users.some((user) => sameLogin(user, change.subject))) {
      users.push(change.subject);
    }
  }
  return { users, teams };
}

/** The first merge, close or reopen after `at` says what the PR was before it; none: as it is now. */
function stateAt(pr: Pr, at: IsoTime): Pr['state'] {
  const transitions = pr.timeline
    .filter((item) => (item.kind === 'merged' || item.kind === 'closed' || item.kind === 'reopened') && item.at > at)
    .toSorted((a, b) => a.at.localeCompare(b.at));
  const first = transitions[0];
  if (first === undefined) {
    return pr.state === 'MERGED' && pr.mergedAt !== null && pr.mergedAt > at ? 'OPEN' : pr.state;
  }
  return first.kind === 'reopened' ? 'CLOSED' : 'OPEN';
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

/** The PR at `at`: everything after it undone (see the file comment). CI and resolved threads stay as they are. */
export function prAsOf(pr: Pr, at: IsoTime): Pr {
  const reviews = pr.reviews.filter((review) => review.submittedAt <= at);
  const commits = pr.commits.filter((commit) => commit.committedAt <= at);
  const pending = pendingAt(pr, at);
  const state = stateAt(pr, at);
  return {
    ...pr,
    state,
    mergedAt: state === 'MERGED' ? pr.mergedAt : null,
    mergedBy: state === 'MERGED' ? pr.mergedBy : null,
    isDraft: draftAt(pr, at),
    reviewDecision: decisionAt(pr, reviews),
    reviewerUsers: pending.users,
    reviewerTeams: pending.teams,
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

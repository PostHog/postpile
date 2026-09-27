import type { Checks, Pr, PrStatus, Review } from '@code-manager/core';

const PASSING = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);

export interface CheckCounts {
  ok: number;
  failed: number;
  /** Still running: no conclusion yet. */
  pending: number;
  total: number;
}

export function checkCounts(checks: Checks): CheckCounts {
  let ok = 0;
  let failed = 0;
  let pending = 0;
  for (const context of checks.contexts) {
    if (context.conclusion === null) {
      pending += 1;
    } else if (PASSING.has(context.conclusion)) {
      ok += 1;
    } else {
      failed += 1;
    }
  }
  return { ok, failed, pending, total: checks.contexts.length };
}

export type ReviewStatus = 'requested' | 'approved' | 'changes_requested' | 'commented' | 'dismissed';

export interface ReviewRow {
  /** User login or "org/team-slug". */
  login: string;
  status: ReviewStatus;
  at: string | null;
}

const REVIEW_STATUS: Record<Review['state'], ReviewStatus | null> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes_requested',
  COMMENTED: 'commented',
  DISMISSED: 'dismissed',
  PENDING: null,
};

/**
 * One row per reviewer. An approval or change request stands over later plain
 * comments, like on GitHub. Pending requests come first, teams last.
 */
export function reviewRows(pr: Pr): ReviewRow[] {
  const oldestFirst = pr.reviews
    .filter((review) => review.state !== 'PENDING')
    .sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : 1));
  const latest = new Map<string, Review>();
  for (const review of oldestFirst) {
    const current = latest.get(review.author);
    // A plain comment only replaces another plain comment.
    if (!current || review.state !== 'COMMENTED' || current.state === 'COMMENTED') {
      latest.set(review.author, review);
    }
  }
  const requested: ReviewRow[] = pr.reviewerUsers.map((login) => ({ login, status: 'requested', at: null }));
  const reviewed: ReviewRow[] = [...latest.values()]
    .filter((review) => !pr.reviewerUsers.includes(review.author))
    .sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1))
    .map((review) => ({ login: review.author, status: REVIEW_STATUS[review.state] ?? 'commented', at: review.submittedAt }));
  const teams: ReviewRow[] = pr.reviewerTeams.map((login) => ({ login, status: 'requested', at: null }));
  return [...requested, ...reviewed, ...teams];
}

/** What stands between the PR and a merge, in a few words. */
export function mergeStatus(pr: Pr): string {
  if (pr.state === 'MERGED') {
    return pr.mergedBy ? `merged by ${pr.mergedBy}` : 'merged';
  }
  if (pr.state === 'CLOSED') {
    return 'closed';
  }
  if (pr.isDraft) {
    return 'draft';
  }
  if (pr.reviewDecision === 'APPROVED') {
    return 'approved';
  }
  if (pr.reviewDecision === 'CHANGES_REQUESTED') {
    return 'changes requested';
  }
  if (pr.reviewDecision === 'REVIEW_REQUIRED') {
    return 'needs review';
  }
  return 'no review rule';
}

/** The last commit's time, or null for a PR without commits in the snapshot. */
export function lastPushAt(pr: Pr): string | null {
  const last = pr.commits[pr.commits.length - 1];
  return last ? last.committedAt : null;
}

/** good: green, neutral: grey, bad: red (failing, changes), merged: purple, queued: amber. */
export type StatusTone = 'good' | 'neutral' | 'bad' | 'merged' | 'queued';

export interface StatusPart {
  text: string;
  tone: StatusTone;
  /** Spelled out for the tooltip. */
  title: string;
}

const LIFECYCLE_PARTS: Record<PrStatus['lifecycle'], StatusPart> = {
  open: { text: 'open', tone: 'good', title: 'Open' },
  draft: { text: 'draft', tone: 'neutral', title: 'Draft' },
  queued: { text: 'queued', tone: 'queued', title: 'In the merge queue' },
  merged: { text: 'merged', tone: 'merged', title: 'Merged' },
  closed: { text: 'closed', tone: 'bad', title: 'Closed without merge' },
};

const REVIEW_PARTS: Record<NonNullable<PrStatus['review']>, StatusPart> = {
  approved: { text: 'approved', tone: 'good', title: 'Approved' },
  changes: { text: 'changes', tone: 'bad', title: 'Changes requested' },
  review: { text: 'review', tone: 'neutral', title: 'Review required' },
};

const CHECK_PARTS: Record<NonNullable<PrStatus['checks']>, StatusPart> = {
  ok: { text: 'ci ok', tone: 'good', title: 'Checks pass' },
  fail: { text: 'ci ✗', tone: 'bad', title: 'Checks fail' },
  pending: { text: 'ci …', tone: 'neutral', title: 'Checks running' },
};

/** The segments of the status pill, leaving out parts that do not apply. */
export function statusParts(status: PrStatus): StatusPart[] {
  const parts = [LIFECYCLE_PARTS[status.lifecycle]];
  if (status.review) {
    parts.push(REVIEW_PARTS[status.review]);
  }
  if (status.checks) {
    parts.push(CHECK_PARTS[status.checks]);
  }
  return parts;
}

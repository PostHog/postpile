import type { Checks, PingReason, Pr, PrState, Provenance, Review } from '@code-manager/core';

export type PrLook = 'open' | 'draft' | 'merged' | 'closed';

export function prLook(pr: { state: PrState; isDraft: boolean }): PrLook {
  if (pr.state === 'MERGED') {
    return 'merged';
  }
  if (pr.state === 'CLOSED') {
    return 'closed';
  }
  return pr.isDraft ? 'draft' : 'open';
}

const PING_LABELS: Record<PingReason, string> = {
  review_requested: 'review requested',
  mention: 'mentioned you',
  team_mention: 'mentioned your team',
  author: 'you are the author',
  assign: 'assigned to you',
  comment: 'you commented',
  subscribed: 'you are subscribed',
  manual: 'you subscribed',
  state_change: 'you changed its state',
  ci_activity: 'CI activity',
  approval_requested: 'approval requested',
  other: 'GitHub notified you',
};

/** One line on why the PR is here: the ping reason, or which stack layer it is ("stack layer below #12"). */
export function provenanceReason(provenance: Provenance): string {
  if (provenance.kind === 'pinged') {
    return PING_LABELS[provenance.reason];
  }
  return provenance.reason;
}

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

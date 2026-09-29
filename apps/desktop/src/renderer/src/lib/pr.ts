import type { Checks, Pr, PrLifecycle, PrStatus, Review } from '@postpile/core';

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

/**
 * The approval in words. `agentApprovers` is core's `agentOnlyApprovers`:
 * "approved by reviewbot (agent)" or "approved by reviewbot and lintbot
 * (agents)" when only agents approved, else plain "approved".
 */
export function approvedText(agentApprovers: string[]): string {
  if (agentApprovers.length === 0) {
    return 'approved';
  }
  if (agentApprovers.length === 1) {
    return `approved by ${agentApprovers[0]} (agent)`;
  }
  const names = `${agentApprovers.slice(0, -1).join(', ')} and ${agentApprovers[agentApprovers.length - 1]}`;
  return `approved by ${names} (agents)`;
}

/** Sentence case for tooltips: "approved by ..." -> "Approved by ...". */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** What stands between the PR and a merge, in a few words. `agentApprovers` as in `approvedText`. */
export function mergeStatus(pr: Pr, agentApprovers: string[]): string {
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
    return approvedText(agentApprovers);
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

/** The lifecycle in one word, as the detail pane's state line and the state icon's tooltip say it. */
export const LIFECYCLE_WORDS: Record<PrLifecycle, { text: string; title: string }> = {
  open: { text: 'Open', title: 'Open' },
  draft: { text: 'Draft', title: 'Draft: not ready for review yet' },
  queued: { text: 'Queued', title: 'In the merge queue' },
  merged: { text: 'Merged', title: 'Merged' },
  closed: { text: 'Closed', title: 'Closed without merge' },
};

/**
 * One state word with its icon: the review state (needs review, approved,
 * changes requested), or on a PR row the draft chip and merged / closed in
 * place of the review. CI is not a state word: checks only show in the
 * detail pane's facts (2026-09-29).
 */
export interface StateWord {
  kind: 'review' | 'approved' | 'changes' | 'draft' | 'merged' | 'closed';
  text: string;
  /** Spelled out for the tooltip. */
  title: string;
}

/**
 * The review state in words, null when none applies (merged, closed,
 * drafts, repos without a review rule). Only agents approved: says so, and
 * names them in the tooltip.
 */
export function reviewWord(status: PrStatus): StateWord | null {
  if (status.review === 'review') {
    return { kind: 'review', text: 'Needs review', title: 'Review required' };
  }
  if (status.review === 'changes') {
    return { kind: 'changes', text: 'Changes requested', title: 'Changes requested' };
  }
  if (status.review !== 'approved') {
    return null;
  }
  if (status.agentApprovers.length === 0) {
    return { kind: 'approved', text: 'Approved', title: 'Approved' };
  }
  return {
    kind: 'approved',
    text: status.agentApprovers.length === 1 ? 'Approved by agent' : 'Approved by agents',
    title: capitalize(approvedText(status.agentApprovers)),
  };
}

/** A PR row's state word: merged, closed and drafts say so, everything else shows its review state. */
export function rowStateWord(status: PrStatus): StateWord | null {
  if (status.lifecycle === 'merged' || status.lifecycle === 'closed') {
    const word = LIFECYCLE_WORDS[status.lifecycle];
    return { kind: status.lifecycle, text: word.text, title: word.title };
  }
  if (status.lifecycle === 'draft') {
    return { kind: 'draft', text: 'Draft', title: LIFECYCLE_WORDS.draft.title };
  }
  return reviewWord(status);
}

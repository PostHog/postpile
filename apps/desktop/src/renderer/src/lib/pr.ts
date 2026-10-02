import type { Checks, MergeQueueStep, Pr, PrIcon, PrStatus, Review } from '@postpile/core';
import { prNumber } from './tiles.ts';
import { sinceLabel } from './time.ts';

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

/**
 * The Checks fact's note, "12 checks · 2 not passing" ("all passing" at
 * none). Neutral words: CI is not a signal here (2026-09-29), so failed and
 * still running both count as not passing, without a colour.
 */
export function checksNote(counts: CheckCounts): string {
  const total = `${counts.total} ${counts.total === 1 ? 'check' : 'checks'}`;
  const notPassing = counts.failed + counts.pending;
  return notPassing === 0 ? `${total} · all passing` : `${total} · ${notPassing} not passing`;
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

/** The state icon (core `PrStatus.icon`) in words, as the detail pane's state line and the icon's tooltip say it. */
export const ICON_WORDS: Record<PrIcon, { text: string; title: string }> = {
  open: { text: 'Open', title: 'Open' },
  draft: { text: 'Draft', title: 'Draft: not ready for review yet' },
  merge_queue: { text: 'Merge queue', title: 'In the merge queue' },
  merge_queue_failed: { text: 'Merge queue: Failed', title: 'Removed from the merge queue' },
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
  kind: 'review' | 'approved' | 'changes' | 'draft' | 'merged' | 'closed' | 'merge_queue' | 'merge_queue_failed';
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

const QUEUE_STEP_WORDS: Record<MergeQueueStep, string> = {
  submitted: 'Submitted',
  waiting: 'Waiting',
  testing: 'Testing',
  failed: 'Failed',
};

/** The tooltip: what the step means and since when ("Testing on #1205 since 06:28"). */
function mergeQueueTitle(status: PrStatus, now: Date): string {
  const queue = status.mergeQueue;
  if (queue === null) {
    return ICON_WORDS.merge_queue.title;
  }
  const since = sinceLabel(queue.since, now);
  switch (queue.state) {
    case 'submitted':
      return `Submitted to the merge queue at ${since}, waiting for checks and approvals`;
    case 'waiting':
      return `In the merge queue since ${since}, tests not started yet`;
    case 'testing':
      return `In the merge queue, testing${queue.testingOn ? ` on #${prNumber(queue.testingOn)}` : ''} since ${since}`;
    case 'failed':
      return `Removed from the merge queue at ${since}${queue.reason ? `: ${queue.reason}` : ''}. Re-submit it to merge.`;
  }
}

/**
 * The merge queue in words (core decides the icon): "Merge queue: Testing"
 * in pending amber, "Merge queue: Failed" in red; `long` adds the reason,
 * "Merge queue: Failed (tests failed)". GitHub's own queue has no step:
 * "Merge queue". Null when the PR is not in a queue.
 */
export function mergeQueueWord(status: PrStatus, now: Date, long = false): StateWord | null {
  if (status.icon !== 'merge_queue' && status.icon !== 'merge_queue_failed') {
    return null;
  }
  const queue = status.mergeQueue;
  const title = mergeQueueTitle(status, now);
  if (status.icon === 'merge_queue_failed') {
    const reason = long && queue?.reason ? ` (${queue.reason})` : '';
    return { kind: 'merge_queue_failed', text: `${ICON_WORDS.merge_queue_failed.text}${reason}`, title };
  }
  const text = queue === null ? ICON_WORDS.merge_queue.text : `Merge queue: ${QUEUE_STEP_WORDS[queue.state]}`;
  return { kind: 'merge_queue', text, title };
}

/** A PR row's state word: merged, closed and drafts say so, a PR in the merge queue says where it stands, everything else shows its review state. */
export function rowStateWord(status: PrStatus, now: Date): StateWord | null {
  if (status.lifecycle === 'merged' || status.lifecycle === 'closed') {
    const word = ICON_WORDS[status.lifecycle];
    return { kind: status.lifecycle, text: word.text, title: word.title };
  }
  if (status.lifecycle === 'draft') {
    return { kind: 'draft', text: 'Draft', title: ICON_WORDS.draft.title };
  }
  return mergeQueueWord(status, now) ?? reviewWord(status);
}

// The PR status pill: lifecycle and review, each left out when it does not
// apply. Pure, from the PR snapshot. No checks: CI is not a signal (DESIGN.md
// "CI is not a signal"); the detail pane reads them from the PR itself.
import { agentOnlyApprovers, standingApprovals } from './approvals.ts';
import type { Pr } from './types.ts';

export type PrLifecycle = 'open' | 'draft' | 'queued' | 'merged' | 'closed';
export type PrReviewStatus = 'approved' | 'changes' | 'review';

export interface PrStatus {
  lifecycle: PrLifecycle;
  /** Null for merged / closed PRs, drafts, and repos without a review rule. */
  review: PrReviewStatus | null;
  /**
   * Bot names ("reviewbot") when the review is approved and only agents
   * approved, so the pill can say "approved by agent". Empty otherwise,
   * including as soon as a person approved.
   */
  agentApprovers: string[];
}

/** In the merge queue: the newest queue entry on the timeline is an "added". */
export function isQueued(pr: Pr): boolean {
  let queued = false;
  for (const item of pr.timeline) {
    if (item.kind === 'added_to_merge_queue') {
      queued = true;
    } else if (item.kind === 'removed_from_merge_queue') {
      queued = false;
    }
  }
  return queued;
}

function lifecycle(pr: Pr): PrLifecycle {
  if (pr.state === 'MERGED') {
    return 'merged';
  }
  if (pr.state === 'CLOSED') {
    return 'closed';
  }
  if (pr.isDraft) {
    return 'draft';
  }
  return isQueued(pr) ? 'queued' : 'open';
}

const REVIEW: Record<Pr['reviewDecision'], PrReviewStatus | null> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes',
  REVIEW_REQUIRED: 'review',
  NONE: null,
};

export function prStatus(pr: Pr): PrStatus {
  const life = lifecycle(pr);
  if (life === 'merged' || life === 'closed') {
    return { lifecycle: life, review: null, agentApprovers: [] };
  }
  const review = life === 'draft' ? null : REVIEW[pr.reviewDecision];
  return {
    lifecycle: life,
    review,
    agentApprovers: review === 'approved' ? agentOnlyApprovers(standingApprovals(pr)) : [],
  };
}

/** Review threads nobody resolved yet. */
export function openThreadCount(pr: Pr): number {
  return pr.threads.filter((thread) => !thread.isResolved).length;
}

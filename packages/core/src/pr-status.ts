// The PR status pill: lifecycle and review, each left out when it does not
// apply, the merge queue, and the state icon they make. Pure, from the PR
// snapshot. No checks: CI is not a signal (DESIGN.md "CI is not a signal");
// the detail pane reads them from the PR itself.
import { agentOnlyApprovers, standingApprovals } from './approvals.ts';
import { mergeQueueState, type MergeQueueState } from './merge-queue.ts';
import type { Pr } from './types.ts';

export type PrLifecycle = 'open' | 'draft' | 'queued' | 'merged' | 'closed';
export type PrReviewStatus = 'approved' | 'changes' | 'review';

/**
 * The PR's state icon, as on GitHub with Trunk's extension (DESIGN.md
 * "Merge queue"): the lifecycle, except that an open PR in the merge queue
 * shows the queue icon, amber while it waits or tests and red once the
 * queue took it out. Merged shows merged again.
 */
export type PrIcon = 'open' | 'draft' | 'merge_queue' | 'merge_queue_failed' | 'merged' | 'closed';

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
  /** Where the PR stands in the Trunk merge queue (`mergeQueueState`); null when it is not in it or not open. */
  mergeQueue: MergeQueueState | null;
  /** The state icon (`prIcon`): every PR row, the detail header and the topic rollups draw it. */
  icon: PrIcon;
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

/**
 * The state icon from the lifecycle and the Trunk queue: open and in the
 * queue (Trunk's, or GitHub's own: `queued`) is the queue icon, failed in
 * Trunk's queue the red one. A draft never enters a queue; merged and
 * closed show as they are.
 */
export function prIcon(life: PrLifecycle, mergeQueue: MergeQueueState | null): PrIcon {
  if (life !== 'open' && life !== 'queued') {
    return life;
  }
  if (mergeQueue?.state === 'failed') {
    return 'merge_queue_failed';
  }
  return mergeQueue !== null || life === 'queued' ? 'merge_queue' : 'open';
}

export function prStatus(pr: Pr): PrStatus {
  const life = lifecycle(pr);
  if (life === 'merged' || life === 'closed') {
    return { lifecycle: life, review: null, agentApprovers: [], mergeQueue: null, icon: life };
  }
  const review = life === 'draft' ? null : REVIEW[pr.reviewDecision];
  const mergeQueue = life === 'draft' ? null : mergeQueueState(pr);
  return {
    lifecycle: life,
    review,
    agentApprovers: review === 'approved' ? agentOnlyApprovers(standingApprovals(pr)) : [],
    mergeQueue,
    icon: prIcon(life, mergeQueue),
  };
}

/** Review threads nobody resolved yet. */
export function openThreadCount(pr: Pr): number {
  return pr.threads.filter((thread) => !thread.isResolved).length;
}

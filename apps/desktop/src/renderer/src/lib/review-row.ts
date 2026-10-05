// The label that opens the detail pane's review row: where the review
// stands for the viewer, from GitHub's data, never from the agent's glance.
import type { PrPaneView, ViewerApproval, ViewerReviewStand } from '@postpile/core';
import { ageLabel } from './time.ts';

export type ReviewRowTone = 'approved' | 'changes' | 'asked' | 'plain';

export interface ReviewRowLabel {
  text: string;
  tone: ReviewRowTone;
}

export interface ReviewRowInput {
  pr: Pick<PrPaneView, 'headOid'>;
  approval: ViewerApproval | null;
  /** Core's `viewerReviewStand`: changes requested, requested from the viewer, their own PR. */
  stand: ViewerReviewStand;
  /** The viewer's teams still asked to review (`PaneOffers.removeTeams`). */
  askedTeams: string[];
  now: Date;
}

/**
 * In order: the viewer's standing approval ("You approved 2h ago", ", commits
 * since" when the head moved), their changes request, a review request for
 * them, then for one of their teams, their own PR, else "Your review".
 */
export function reviewRowLabel(input: ReviewRowInput): ReviewRowLabel {
  if (input.approval) {
    const moved = input.approval.commitOid !== null && input.approval.commitOid !== input.pr.headOid;
    return { text: `You approved ${ageLabel(input.approval.at, input.now)} ago${moved ? ', commits since' : ''}`, tone: 'approved' };
  }
  if (input.stand === 'changes_requested') {
    return { text: 'You requested changes', tone: 'changes' };
  }
  if (input.stand === 'requested') {
    return { text: 'Review requested from you', tone: 'asked' };
  }
  const team = input.askedTeams[0];
  if (team) {
    // "acme/team-devex" reads as "team-devex", like the Remove button.
    return { text: `Review requested from ${team.split('/').pop() ?? team}`, tone: 'asked' };
  }
  if (input.stand === 'own_pr') {
    return { text: 'Your PR', tone: 'plain' };
  }
  return { text: 'Your review', tone: 'plain' };
}

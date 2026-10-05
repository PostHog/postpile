// The label that opens the detail pane's review row: where the review
// stands for the viewer, from GitHub's data, never from the agent's glance.
import type { Pr, ViewerApproval } from '@postpile/core';
import { ageLabel } from './time.ts';

export type ReviewRowTone = 'approved' | 'changes' | 'asked' | 'plain';

export interface ReviewRowLabel {
  text: string;
  tone: ReviewRowTone;
}

export interface ReviewRowInput {
  pr: Pick<Pr, 'author' | 'reviews' | 'reviewerUsers' | 'headOid'>;
  /** Null before the first sync stored the viewer. */
  viewerLogin: string | null;
  approval: ViewerApproval | null;
  /** The viewer's teams still asked to review (`PaneOffers.removeTeams`). */
  askedTeams: string[];
  now: Date;
}

/** The viewer's newest verdict review: approved or changes requested, comments do not count. */
function viewerVerdict(input: ReviewRowInput): 'APPROVED' | 'CHANGES_REQUESTED' | null {
  const verdicts = input.pr.reviews.filter(
    (review) => review.author === input.viewerLogin && (review.state === 'APPROVED' || review.state === 'CHANGES_REQUESTED'),
  );
  const newest = verdicts.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
  return newest ? (newest.state as 'APPROVED' | 'CHANGES_REQUESTED') : null;
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
  if (viewerVerdict(input) === 'CHANGES_REQUESTED') {
    return { text: 'You requested changes', tone: 'changes' };
  }
  if (input.viewerLogin !== null && input.pr.reviewerUsers.includes(input.viewerLogin)) {
    return { text: 'Review requested from you', tone: 'asked' };
  }
  const team = input.askedTeams[0];
  if (team) {
    // "acme/team-devex" reads as "team-devex", like the Remove button.
    return { text: `Review requested from ${team.split('/').pop() ?? team}`, tone: 'asked' };
  }
  if (input.viewerLogin !== null && input.pr.author === input.viewerLogin) {
    return { text: 'Your PR', tone: 'plain' };
  }
  return { text: 'Your review', tone: 'plain' };
}

// The label that opens the detail pane's review row: where the review
// stands for the viewer, from GitHub's data, never from the agent's glance.
import { isPrOwner, newestVerdictBy, sameLogin, teamSlug, type Pr, type ViewerApproval } from '@postpile/core';
import { ageLabel } from './time.ts';

export type ReviewRowTone = 'approved' | 'changes' | 'asked' | 'plain';

export interface ReviewRowLabel {
  text: string;
  tone: ReviewRowTone;
}

export interface ReviewRowInput {
  pr: Pick<Pr, 'author' | 'assignees' | 'reviews' | 'reviewerUsers' | 'headOid'>;
  /** Null before the first sync stored the viewer. */
  viewerLogin: string | null;
  approval: ViewerApproval | null;
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
  const login = input.viewerLogin;
  // Core's verdict rule, as the tiers and whose move read it: a dismissal ends a change request.
  if (login !== null && newestVerdictBy(input.pr.reviews, login)?.state === 'CHANGES_REQUESTED') {
    return { text: 'You requested changes', tone: 'changes' };
  }
  if (login !== null && input.pr.reviewerUsers.some((user) => sameLogin(user, login))) {
    return { text: 'Review requested from you', tone: 'asked' };
  }
  const team = input.askedTeams[0];
  if (team) {
    // "acme/team-devex" reads as "team-devex", like the Remove button.
    return { text: `Review requested from ${teamSlug(team)}`, tone: 'asked' };
  }
  if (login !== null && isPrOwner(input.pr, login)) {
    return { text: 'Your PR', tone: 'plain' };
  }
  return { text: 'Your review', tone: 'plain' };
}

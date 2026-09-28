// Review requests as they concern the viewer: personal, for their team on a
// teammate's PR (counts like personal), for their team on someone else's PR
// (routed), or already taken by a teammate. Rules only. Whose turn, for
// whom, tiers and the done rule all read the same answer.
import { isBot } from './bots.ts';
import { isOwnTeam, sameLogin } from './mentions.ts';
import type { IsoTime, Pr, Review, UserPrState, Viewer } from './types.ts';

/**
 * you: the viewer is a requested reviewer.
 * team_for_you: one of the viewer's teams is requested on a PR a teammate
 * wrote, and no other teammate approved or requested changes yet. Counts
 * like a personal request (2026-09-28).
 * team: one of the viewer's teams is requested on a PR by someone outside
 * the team (routed), and no teammate reviewed yet.
 * team_taken: a teammate already picked the team request up.
 * null: no pending request for the viewer or their teams.
 */
export type ReviewRequest = 'you' | 'team_for_you' | 'team' | 'team_taken' | null;

/** An approve, request-changes or dismissed review: a verdict. A plain comment review is none. */
export function isVerdict(review: Review): boolean {
  return review.state === 'APPROVED' || review.state === 'CHANGES_REQUESTED' || review.state === 'DISMISSED';
}

/** The newest verdict review by `login`, or null. */
export function newestVerdictBy(reviews: Review[], login: string): Review | null {
  let newest: Review | null = null;
  for (const review of reviews) {
    if (isVerdict(review) && sameLogin(review.author, login) && (newest === null || review.submittedAt > newest.submittedAt)) {
      newest = review;
    }
  }
  return newest;
}

/** When the viewer approved and on which commit (null when unknown). */
export interface ViewerApproval {
  at: IsoTime;
  commitOid: string | null;
}

/**
 * The viewer's standing approval, on any commit: from the app (the stored
 * approval) or on github.com (their newest verdict review is an approval).
 * Approvals do not follow the head: a push after approval does not undo it
 * (decided 2026-09-28). Null when they have not approved.
 *
 * The stored approval only bridges the gap until GitHub shows the viewer's
 * review on the approved commit. From then on GitHub's newest verdict
 * decides, so a later change request or a dismissal (which keeps the
 * original submittedAt) wins over the local timestamp.
 */
export function viewerApproval(pr: Pr, userState: UserPrState | null, viewerLogin?: string): ViewerApproval | null {
  const newest = viewerLogin === undefined ? null : newestVerdictBy(pr.reviews, viewerLogin);
  const approvedInApp = userState?.approvedAt ?? null;
  const approvedCommit = userState?.approvedCommitOid ?? null;
  const onGitHub =
    viewerLogin !== undefined &&
    approvedCommit !== null &&
    pr.reviews.some((review) => isVerdict(review) && sameLogin(review.author, viewerLogin) && review.commitOid === approvedCommit);
  if (approvedInApp !== null && !onGitHub && (!newest || approvedInApp >= newest.submittedAt)) {
    return { at: approvedInApp, commitOid: approvedCommit };
  }
  return newest?.state === 'APPROVED' ? { at: newest.submittedAt, commitOid: newest.commitOid } : null;
}

/** The viewer approved the PR, on any commit (see `viewerApproval`). */
export function isApprovedByViewer(pr: Pr, userState: UserPrState | null, viewerLogin?: string): boolean {
  return viewerApproval(pr, userState, viewerLogin) !== null;
}

/** The login is on one of the viewer's teams (never true before the member list is fetched). */
export function isTeammate(login: string, viewer: Viewer): boolean {
  return (viewer.teamMembers ?? []).some((member) => sameLogin(member, login));
}

/**
 * Humans other than the author and the viewer who submitted a review and
 * are on one of the viewer's teams. Until the member list has been fetched
 * (`teamMembers` missing) any other reviewer counts.
 */
function teammateReviews(pr: Pr, viewer: Viewer): Review[] {
  const members = viewer.teamMembers;
  return pr.reviews.filter((review) => {
    if (review.state === 'PENDING' || sameLogin(review.author, viewer.login) || sameLogin(review.author, pr.author) || isBot(review.author)) {
      return false;
    }
    return members === undefined || members.some((member) => sameLogin(member, review.author));
  });
}

/**
 * Teammates who picked up the team request, each once, in review order. On
 * a teammate's PR only an approval or a change request counts; a comment
 * alone does not cover it. On anyone else's PR any review counts.
 */
export function teamRequestTakenBy(pr: Pr, viewer: Viewer): string[] {
  const byTeammate = isTeammate(pr.author, viewer);
  const covering = teammateReviews(pr, viewer).filter(
    (review) => !byTeammate || review.state === 'APPROVED' || review.state === 'CHANGES_REQUESTED',
  );
  const logins: string[] = [];
  for (const review of covering) {
    if (!logins.some((login) => sameLogin(login, review.author))) {
      logins.push(review.author);
    }
  }
  return logins;
}

/** The pending review request that concerns the viewer, see `ReviewRequest`. */
export function reviewRequest(pr: Pr, viewer: Viewer): ReviewRequest {
  if (pr.reviewerUsers.some((login) => sameLogin(login, viewer.login))) {
    return 'you';
  }
  if (!pr.reviewerTeams.some((team) => isOwnTeam(team, viewer.teams))) {
    return null;
  }
  if (teamRequestTakenBy(pr, viewer).length > 0) {
    return 'team_taken';
  }
  return isTeammate(pr.author, viewer) ? 'team_for_you' : 'team';
}

/** A personal request, or a team request that counts like one. */
export function isPersonalRequest(request: ReviewRequest): boolean {
  return request === 'you' || request === 'team_for_you';
}

/** The viewer reviewed the current head, or approved on any commit (an approval does not follow the head). */
export function reviewedHead(pr: Pr, viewer: Viewer, userState: UserPrState | null = null): boolean {
  const onHead = pr.reviews.some((review) => sameLogin(review.author, viewer.login) && review.state !== 'PENDING' && review.commitOid === pr.headOid);
  return onHead || isApprovedByViewer(pr, userState, viewer.login);
}

/**
 * A review is still asked of the viewer and they have not given one: an
 * open, non-draft PR by someone else with a personal request, a team
 * request on a teammate's PR, or a routed team request nobody on the team
 * picked up yet, and the head not reviewed. A team request a teammate
 * already took asks nothing more of the viewer.
 */
export function reviewPending(pr: Pr, viewer: Viewer, userState: UserPrState | null = null): boolean {
  if (pr.state !== 'OPEN' || pr.isDraft || sameLogin(pr.author, viewer.login)) {
    return false;
  }
  const request = reviewRequest(pr, viewer);
  return request !== null && request !== 'team_taken' && !reviewedHead(pr, viewer, userState);
}

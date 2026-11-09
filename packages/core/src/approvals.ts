// Who approved a PR: people or agents. A bot approval (for example an AI
// review agent) counts like any approval, as it does on GitHub. The app only
// says in words who it came from, so an agent-only approval is a visible,
// neutral fact rather than a silent "approved".
import { isBot } from './bots.ts';
import type { IsoTime, Pr, Review } from './types.ts';

export interface Approvals {
  /** Human logins with a standing approval, oldest first. */
  people: string[];
  /** Bot logins with a standing approval, oldest first. */
  agents: string[];
}

/** Reviews that set a reviewer's stance. Plain comments and pending drafts never change it. */
const DECIDING: ReadonlySet<Review['state']> = new Set<Review['state']>(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']);

/** What `latestDecidingReviews` reads of a review. */
export type ReviewStance = Pick<Review, 'author' | 'state' | 'submittedAt'>;

/**
 * Each reviewer's latest deciding review (approved, changes requested or
 * dismissed), ordered by when it was submitted, oldest first. Plain
 * comments and pending drafts never change a reviewer's stance.
 */
export function latestDecidingReviews<T extends ReviewStance>(reviews: T[]): T[] {
  const oldestFirst = reviews.filter((review) => DECIDING.has(review.state)).sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : 1));
  const latest = new Map<string, T>();
  for (const review of oldestFirst) {
    // Delete first so a re-approval moves the reviewer to the end.
    latest.delete(review.author);
    latest.set(review.author, review);
  }
  return [...latest.values()];
}

/**
 * Standing approvals: reviewers whose latest deciding review is an approval.
 * A later change request or dismissal takes it back, like on GitHub. Any
 * commit counts. The PR author never appears (GitHub does not let them approve).
 */
export function standingApprovals(pr: Pr): Approvals {
  const approvers = latestDecidingReviews(pr.reviews)
    .filter((review) => review.state === 'APPROVED')
    .map((review) => review.author);
  return {
    people: approvers.filter((login) => !isBot(login)),
    agents: approvers.filter((login) => isBot(login)),
  };
}

/** "reviewbot[bot]" -> "reviewbot". Plain logins stay as they are. */
export function botName(login: string): string {
  return login.replace(/\[bot\]$/, '');
}

/**
 * The agents to name when only agents approved: their names ("reviewbot"),
 * else empty. Empty as soon as one person approved, since then the usual
 * "approved" says it all. The UI turns this into "approved by reviewbot
 * (agent)".
 */
export function agentOnlyApprovers(approvals: Approvals): string[] {
  return approvals.people.length > 0 ? [] : approvals.agents.map(botName);
}


/** A point the viewer reviewed or approved at: when, and the head commit it was made on (null when GitHub did not say). */
export interface ReviewPoint {
  at: IsoTime;
  commitOid: string | null;
}

/**
 * The PR's commits pushed after a review point: the ones after its commit
 * in the PR's commit list. When that commit is gone (a force push) or
 * unknown, the ones committed after the point's time. Empty without a point.
 */
export function commitsAfter(pr: Pick<Pr, 'commits'>, point: ReviewPoint | null): Set<string> {
  if (!point) {
    return new Set();
  }
  const index = pr.commits.findIndex((commit) => commit.oid === point.commitOid);
  if (index >= 0) {
    return new Set(pr.commits.slice(index + 1).map((commit) => commit.oid));
  }
  return new Set(pr.commits.filter((commit) => commit.committedAt > point.at).map((commit) => commit.oid));
}

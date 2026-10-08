// Where each reviewer of a PR stands, people and agents apart: MCP's review
// line ("approved by alice; pending: team-platform; agents: reviewbot
// approved"). The latest deciding review per reviewer wins, as on GitHub:
// a later approval replaces a change request, a dismissal drops the
// reviewer, and plain comments set no state. Pure, from the PR snapshot.
import { botName, latestDecidingReviews, type ReviewStance } from './approvals.ts';
import { isBot } from './bots.ts';
import type { Pr } from './types.ts';

export type AgentReviewState = 'approved' | 'changes_requested' | 'pending';

export interface AgentReviewer {
  /** The bot's name without "[bot]" ("reviewbot"). */
  name: string;
  state: AgentReviewState;
}

export interface ReviewerStates {
  /** People whose latest deciding review is an approval, oldest first. */
  approvedBy: string[];
  /** People whose latest deciding review requests changes, oldest first. */
  changesRequestedBy: string[];
  /** People still asked to review, as GitHub lists them. A re-requested reviewer can also have a state above. */
  pendingUsers: string[];
  /** Teams still asked to review, "org/team-slug". */
  pendingTeams: string[];
  /** Bots and agents: their latest deciding review, or pending while asked and without one. */
  agents: AgentReviewer[];
}

/** What `reviewerStates` reads of a PR; the stored `Pr` and the pane's `PrPaneView` both have it. */
export type ReviewerSource = Pick<Pr, 'reviewerUsers' | 'reviewerTeams'> & { reviews: ReviewStance[] };

export function reviewerStates(pr: ReviewerSource): ReviewerStates {
  const latest = latestDecidingReviews(pr.reviews).filter((review) => review.state !== 'DISMISSED');
  const people = latest.filter((review) => !isBot(review.author));
  const agents: AgentReviewer[] = latest
    .filter((review) => isBot(review.author))
    .map((review) => ({ name: botName(review.author), state: review.state === 'APPROVED' ? 'approved' : 'changes_requested' }));
  const reviewed = new Set(agents.map((agent) => agent.name.toLowerCase()));
  for (const login of pr.reviewerUsers.filter((user) => isBot(user))) {
    if (!reviewed.has(botName(login).toLowerCase())) {
      agents.push({ name: botName(login), state: 'pending' });
    }
  }
  return {
    approvedBy: people.filter((review) => review.state === 'APPROVED').map((review) => review.author),
    changesRequestedBy: people.filter((review) => review.state === 'CHANGES_REQUESTED').map((review) => review.author),
    pendingUsers: pr.reviewerUsers.filter((user) => !isBot(user)),
    pendingTeams: [...pr.reviewerTeams],
    agents,
  };
}

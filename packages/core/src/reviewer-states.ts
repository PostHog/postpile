// Where each reviewer of a PR stands, people and agents apart: MCP's review
// line ("approved by alice; pending: team-platform; agents: reviewbot
// approved"). The latest deciding review per reviewer wins, as on GitHub:
// a later approval replaces a change request, a dismissal drops the
// reviewer, and plain comments set no state. A deleted account (an empty
// login) is dropped: several of them cannot be told apart. Pure, from the
// PR snapshot.
import { botName, latestDecidingReviews, type ReviewStance } from './approvals.ts';
import { isBot } from './bots.ts';
import type { Pr } from './types.ts';

export type AgentReviewState = 'approved' | 'changes_requested';

export interface AgentReviewer {
  /** The bot's name without "[bot]" ("reviewbot"). */
  name: string;
  /** Its latest deciding review; null when it has none. */
  state: AgentReviewState | null;
  /** Still asked to review; a re-requested agent keeps its state as well, like a person. */
  pending: boolean;
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
  /** Bots and agents: their latest deciding review and whether they are still asked. */
  agents: AgentReviewer[];
}

/** What `reviewerStates` reads of a PR; the stored `Pr` and the pane's `PrPaneView` both have it. */
export type ReviewerSource = Pick<Pr, 'reviewerUsers' | 'reviewerTeams'> & { reviews: ReviewStance[] };

export function reviewerStates(pr: ReviewerSource): ReviewerStates {
  const latest = latestDecidingReviews(pr.reviews).filter((review) => review.state !== 'DISMISSED' && review.author !== '');
  const people = latest.filter((review) => !isBot(review.author));
  const pendingAgents = pr.reviewerUsers.filter((user) => user !== '' && isBot(user)).map(botName);
  const isPending = (name: string): boolean => pendingAgents.some((pending) => pending.toLowerCase() === name.toLowerCase());
  const agents: AgentReviewer[] = latest
    .filter((review) => isBot(review.author))
    .map((review) => {
      const name = botName(review.author);
      return { name, state: review.state === 'APPROVED' ? 'approved' : 'changes_requested', pending: isPending(name) };
    });
  for (const name of pendingAgents) {
    if (!agents.some((agent) => agent.name.toLowerCase() === name.toLowerCase())) {
      agents.push({ name, state: null, pending: true });
    }
  }
  return {
    approvedBy: people.filter((review) => review.state === 'APPROVED').map((review) => review.author),
    changesRequestedBy: people.filter((review) => review.state === 'CHANGES_REQUESTED').map((review) => review.author),
    pendingUsers: pr.reviewerUsers.filter((user) => user !== '' && !isBot(user)),
    pendingTeams: [...pr.reviewerTeams],
    agents,
  };
}

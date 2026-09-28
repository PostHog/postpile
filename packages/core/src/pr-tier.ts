// PR tiers, ported from ghatchup's triage.Classify: which PR-level queue an
// open PR belongs to. Rules only, no agent. The sidebar's queue sections
// are built on it (`topicQueues`).
import { isOwnTeam, sameLogin } from './mentions.ts';
import type { EventKind, NotificationReason, Pr, PrEvent, Viewer } from './types.ts';
import { unansweredAsk } from './whose-turn.ts';

/**
 * needs_reply: a human spoke to the viewer (mention, question, reply) and
 * they have not answered. mine: the viewer wrote it. team: a teammate wrote
 * it. to_review: a review is asked of the viewer or their team and they have
 * not reviewed the head. team_mentioned: the team was @-mentioned. rest:
 * everything else, and every PR that is not open.
 */
export type PrTier = 'needs_reply' | 'mine' | 'team' | 'to_review' | 'team_mentioned' | 'rest';

/** First match wins, in this order. */
export const PR_TIER_ORDER: PrTier[] = ['needs_reply', 'mine', 'team', 'to_review', 'team_mentioned', 'rest'];

/** Asks that want an answer from the viewer. Team mentions have their own tier. */
const REPLY_KINDS: EventKind[] = ['question_to_user', 'mention', 'reply_to_user'];

export interface PrTierInput {
  pr: Pr;
  events: PrEvent[];
  viewer: Viewer;
  /** The notification thread's reason, when there is a thread. */
  reason: NotificationReason | null;
}

function isTeammate(login: string, viewer: Viewer): boolean {
  return (viewer.teamMembers ?? []).some((member) => sameLogin(member, login));
}

function reviewedHead(pr: Pr, viewer: Viewer): boolean {
  return pr.reviews.some((review) => sameLogin(review.author, viewer.login) && review.state !== 'PENDING' && review.commitOid === pr.headOid);
}

function reviewAsked(pr: Pr, viewer: Viewer): boolean {
  const asksYou = pr.reviewerUsers.some((login) => sameLogin(login, viewer.login));
  return asksYou || pr.reviewerTeams.some((team) => isOwnTeam(team, viewer.teams));
}

/**
 * The GitHub reason is last-write-wins (a merge after a team mention reports
 * state_change), so the stored team_mention events count as well.
 */
function teamMentioned(input: PrTierInput): boolean {
  return input.reason === 'team_mention' || input.events.some((event) => event.kind === 'team_mention');
}

/** The one tier an open PR goes into; an unanswered ask wins over authorship, like in ghatchup. */
export function prTier(input: PrTierInput): PrTier {
  const { pr, viewer } = input;
  if (pr.state !== 'OPEN') {
    return 'rest';
  }
  if (unansweredAsk(pr, input.events, viewer, REPLY_KINDS) !== null) {
    return 'needs_reply';
  }
  if (sameLogin(pr.author, viewer.login)) {
    return 'mine';
  }
  if (isTeammate(pr.author, viewer)) {
    return 'team';
  }
  // A draft is not up for review: it never lands in To review.
  if (!pr.isDraft && reviewAsked(pr, viewer) && !reviewedHead(pr, viewer)) {
    return 'to_review';
  }
  if (teamMentioned(input)) {
    return 'team_mentioned';
  }
  return 'rest';
}

// PR tiers, ported from ghatchup's triage.Classify: which PR-level queue an
// open PR belongs to. Rules only, no agent. The sidebar's queue sections
// are built on it (`topicQueues`).
import { changesAnswered } from './changes-answered.ts';
import { sameLogin } from './mentions.ts';
import { isPersonalRequest, isTeammate, reviewedHead, reviewRequest } from './review-request.ts';
import type { EventKind, NotificationReason, Pr, PrEvent, Viewer } from './types.ts';
import { unansweredAsk } from './whose-turn.ts';

/**
 * needs_reply: a human spoke to the viewer (mention, question, reply) and
 * they have not answered. mine: the viewer wrote it. team: a teammate wrote
 * it. to_review: a review is asked of the viewer or their team and they have
 * not reviewed the head, or the author addressed the viewer's changes request
 * (pushed or replied after it, no re-request needed). A personal request and
 * a team request on a teammate's PR go before `team`; a teammate's PR with
 * only a taken team request stays `team`. team_mentioned: the team was @-mentioned. rest:
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
  const ask = unansweredAsk(pr, input.events, viewer, REPLY_KINDS);
  // Addressed your changes: a re-review, even from a teammate. The author's
  // thread replies are part of it; an ask from anyone else still wins.
  const answered = !pr.isDraft && changesAnswered(pr, viewer) !== null;
  if (ask !== null && !(answered && sameLogin(ask.actor, pr.author))) {
    return 'needs_reply';
  }
  if (answered) {
    return 'to_review';
  }
  if (sameLogin(pr.author, viewer.login)) {
    return 'mine';
  }
  // A draft is not up for review: it never lands in To review.
  const request = pr.isDraft || reviewedHead(pr, viewer) ? null : reviewRequest(pr, viewer);
  // A personal request, or a team request on a teammate's PR, is owed even to a teammate.
  if (isPersonalRequest(request)) {
    return 'to_review';
  }
  if (isTeammate(pr.author, viewer)) {
    return 'team';
  }
  if (request !== null) {
    return 'to_review';
  }
  if (teamMentioned(input)) {
    return 'team_mentioned';
  }
  return 'rest';
}

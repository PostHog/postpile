// PR tiers, ported from ghatchup's triage.Classify: which PR-level queue an
// open PR belongs to. Rules only, no agent. The sidebar's queue sections
// are built on it (`topicQueues`).
import { changesAnswered } from './changes-answered.ts';
import { PERSONAL_ASK_KINDS } from './kinds.ts';
import { isPrOwner } from './pr-owners.ts';
import { isPersonalRequest, ownedByTeammate, reviewedHead, reviewRequest, viewerRequestedChanges } from './review-request.ts';
import type { NotificationReason, Pr, PrEvent, UserPrState, Viewer } from './types.ts';
import { unansweredAsk } from './whose-turn.ts';

/**
 * needs_reply: a human spoke to the viewer (mention, question, reply) and
 * they have not answered. changes_requested: the viewer's newest verdict on
 * someone else's PR asks for changes, whether the author addressed them
 * (pushed or replied after it, no re-request needed) or not yet. mine: the
 * viewer owns it (`prOwners`: wrote it, or a bot opened it and assigned
 * them). team: a teammate owns it. to_review: a review is asked
 * of the viewer or their team and they have not reviewed the head. A
 * personal request, a home team request on a teammate's PR and a routing
 * team's request go before `team`; a teammate's PR with only a taken team
 * request stays `team`.
 * team_mentioned: the team was @-mentioned. rest: everything else, and every
 * PR that is not open.
 */
export type PrTier = 'needs_reply' | 'changes_requested' | 'mine' | 'team' | 'to_review' | 'team_mentioned' | 'rest';

/**
 * The one tier order, as a type: the renderer imports types only, so its
 * copy of the order is typed `PrTierOrder` and fails to compile if it ever
 * differs from this one.
 */
export type PrTierOrder = readonly ['needs_reply', 'changes_requested', 'mine', 'team', 'to_review', 'team_mentioned', 'rest'];

/**
 * First match wins, in this order. The one tier order: the sidebar's queue
 * sections and a topic's priority follow it.
 */
export const PR_TIER_ORDER: PrTierOrder = ['needs_reply', 'changes_requested', 'mine', 'team', 'to_review', 'team_mentioned', 'rest'];

export interface PrTierInput {
  pr: Pr;
  events: PrEvent[];
  viewer: Viewer;
  /** The stored in-app approval counts as a review of the head, like everywhere else. */
  userState: UserPrState | null;
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
  // Personal asks only: team mentions have their own tier.
  const ask = unansweredAsk(pr, input.events, viewer, PERSONAL_ASK_KINDS);
  // Addressed your changes: the author's thread replies are part of it, so
  // they stay under Changes you requested; an ask from anyone else still wins.
  const answered = changesAnswered(pr, viewer) !== null;
  if (ask !== null && !(answered && isPrOwner(pr, ask.actor))) {
    return 'needs_reply';
  }
  if (viewerRequestedChanges(pr, viewer)) {
    return 'changes_requested';
  }
  if (isPrOwner(pr, viewer.login)) {
    return 'mine';
  }
  // A draft is not up for review: it never lands in To review.
  const request = pr.isDraft || reviewedHead(pr, viewer, input.userState) ? null : reviewRequest(pr, viewer);
  // A personal request, or a team request on a teammate's PR, is owed even to a teammate.
  if (isPersonalRequest(request)) {
    return 'to_review';
  }
  // Routed on a teammate's PR can only be a routing team's request (2026-09-30): a review owed, not Team's PRs.
  if (request === 'team' && ownedByTeammate(pr, viewer)) {
    return 'to_review';
  }
  if (ownedByTeammate(pr, viewer)) {
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

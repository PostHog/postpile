// "Routed team requests ping when the glance says Look closer" (DESIGN.md,
// Live poll and Mac pings, 2026-09-29). A review routed to the viewer's team
// on a PR from outside the team does not go to the ping-decision agent; it
// pings once, when the PR's glance is written with verdict LOOK_CLOSER, and
// that ping marks the tile unread through an app-made `look_closer` event.
// Rules only, no IO.
import { isOwnTeam, sameLogin } from './mentions.ts';
import { isPrOwner } from './pr-owners.ts';
import { ownedByTeammate, reviewedHead, reviewRequestTarget, teamSlug } from './review-request.ts';
import { isRoutingTeam } from './team-roles.ts';
import type { Glance, IsoTime, Pr, PrEvent, UserPrState, Viewer } from './types.ts';

/**
 * A request for this team on this PR is routed: the team only routes
 * reviews to the viewer (on anyone's PR but theirs, 2026-09-30), or it is
 * a home team and the PR is from outside it (not theirs, not a teammate's,
 * see `prOwners`).
 */
function isRoutedTeam(team: string, pr: Pr, viewer: Viewer): boolean {
  if (isPrOwner(pr, viewer.login) || !isOwnTeam(team, viewer.teams)) {
    return false;
  }
  return isRoutingTeam(team, viewer) || !ownedByTeammate(pr, viewer);
}

/**
 * A review request event for one of the viewer's teams that is routed
 * (`isRoutedTeam`). Routed on purpose ignores a teammate's review: a Look
 * closer verdict pings anyway (DESIGN.md "Routed team requests ping when
 * the glance says Look closer").
 */
export function isRoutedTeamRequestEvent(event: PrEvent, pr: Pr, viewer: Viewer): boolean {
  if (event.kind !== 'review_requested') {
    return false;
  }
  const subject = reviewRequestTarget(event, pr);
  return subject !== null && !sameLogin(subject, viewer.login) && isRoutedTeam(subject, pr, viewer);
}

/** The viewer's team with a pending routed review request on this open PR, or null. */
export function routedTeamRequest(pr: Pr, viewer: Viewer): string | null {
  if (pr.state !== 'OPEN' || pr.isDraft) {
    return null;
  }
  return pr.reviewerTeams.find((team) => isRoutedTeam(team, pr, viewer)) ?? null;
}

/**
 * Which request the team has pending: the newest timeline request for it,
 * so a new request after a removal counts as a new one. `pending:<team>`
 * when the timeline does not show it.
 */
export function teamRequestId(pr: Pr, team: string): string {
  const slug = teamSlug(team).toLowerCase();
  const requests = pr.timeline
    .filter((item) => item.kind === 'review_requested' && item.subject !== null && teamSlug(item.subject).toLowerCase() === slug)
    .sort((a, b) => (a.at < b.at ? -1 : 1));
  return requests.at(-1)?.id ?? `pending:${team}`;
}

export interface LookCloserPingInput {
  pr: Pr;
  viewer: Viewer;
  glance: Pick<Glance, 'verdict'> | null;
  userState: UserPrState | null;
  /** A tile holding the PR is snoozed. */
  snoozed: boolean;
  /** The request id this PR already pinged for, null when it never did. */
  pingedRequestId: string | null;
}

/**
 * Why a written glance does not ping:
 * - not_look_closer: the verdict is LOOKS_SAFE, NOT_YOURS or missing
 * - no_routed_request: no routed team request of the viewer's is pending (a personal request or a teammate's PR pings by the rules)
 * - reviewed: the viewer reviewed the head (or approved)
 * - snoozed: a tile holding the PR is snoozed
 * - already_pinged: this request pinged once already
 */
export type LookCloserSkip = 'not_look_closer' | 'no_routed_request' | 'reviewed' | 'snoozed' | 'already_pinged';

export type LookCloserPing = { kind: 'ping'; team: string; requestId: string } | { kind: 'skip'; why: LookCloserSkip };

/**
 * A routed team request pings when the glance says Look closer, even when a
 * teammate reviewed already ("if the verdict was look closer we can ignore
 * teammate even"). Once per request.
 */
export function lookCloserPingCheck(input: LookCloserPingInput): LookCloserPing {
  if (input.glance?.verdict !== 'LOOK_CLOSER') {
    return { kind: 'skip', why: 'not_look_closer' };
  }
  const team = routedTeamRequest(input.pr, input.viewer);
  if (team === null) {
    return { kind: 'skip', why: 'no_routed_request' };
  }
  if (reviewedHead(input.pr, input.viewer, input.userState)) {
    return { kind: 'skip', why: 'reviewed' };
  }
  if (input.snoozed) {
    return { kind: 'skip', why: 'snoozed' };
  }
  const requestId = teamRequestId(input.pr, team);
  if (input.pingedRequestId === requestId) {
    return { kind: 'skip', why: 'already_pinged' };
  }
  return { kind: 'ping', team, requestId };
}

/** The reason line of the ping decision and the app-made event: "Look closer: review routed to team-devex". */
export function lookCloserReason(team: string): string {
  return `Look closer: review routed to ${teamSlug(team)}`;
}

/**
 * The app-made event that makes the tile unread when the ping fires. Loud,
 * unseen, kept across snapshot stores (not derived from GitHub); a mark-read
 * clears it like any other.
 */
export function lookCloserEvent(pr: Pr, team: string, requestId: string, at: IsoTime): PrEvent {
  return {
    id: `${pr.key}:look_closer:${requestId}`,
    prKey: pr.key,
    kind: 'look_closer',
    actor: '',
    isBot: true,
    at,
    summary: lookCloserReason(team),
    url: pr.url,
    sourceId: requestId,
    ruleLoudness: 'loud',
    ruleReason: lookCloserReason(team),
    override: null,
    seenAt: null,
  };
}

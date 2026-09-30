// The rules restated from the spec (DESIGN "Whose turn", "Rules layer: one
// home per fact", "Handled quietly", "Live poll and Mac pings", "Look closer
// pings", "Reading a PR is one planner"), over the raw snapshot and the
// board's events. The event invariant checks the events themselves against
// the snapshot (spec-events.ts), so these read an event's kind, actor, time
// and loudness, never a rule's answer about it. Each function says what the
// app should do; the invariants compare the app's answer with it. Type
// imports only from the rule modules.
import type { ForWhom } from '../for-whom.ts';
import type { LookCloserPing } from '../glance-pings.ts';
import { sameLogin } from '../mentions.ts';
import type { PingRuleClass } from '../pings.ts';
import type { PrTier } from '../pr-tier.ts';
import type { JudgedReadCheck, OpenedReadCheck, QuietReadCheck, TouchedReadCheck } from '../quiet-reads.ts';
import type { ReadCause, ReadScope } from '../read-plan.ts';
import type { EventKind, IsoTime, Loudness, NotificationReason, NotificationThread, Pr, PrEvent, PrKey, Snooze, UserPrState, Verdict, Viewer } from '../types.ts';
import type { WhyCode } from '../why-here.ts';
import type { YourMove } from '../whose-turn.ts';
import { answersChanges, SPEC_ADDRESSED_KINDS, SPEC_PERSONAL_ASK_KINDS, SPEC_PUSH_KINDS } from './spec-events.ts';
import {
  askedToReReview,
  asksViewer,
  changesAnswer,
  isAutomationLogin,
  isHomeTeam,
  isOwner,
  isRoutedTeam,
  isRoutingTeam,
  isViewerLogin,
  mentionsOnlyRoutingTeams,
  namedOwner,
  newestTouch,
  pendingRequest,
  pendingRequestTeam,
  READING_TOUCHES,
  requestSubjectOf,
  reviewStillOwed,
  routedRequestWaits,
  standingChangesBy,
  teammateOwns,
  teamTakers,
  threadsViewerOpened,
  threadsWaitingOnViewer,
  viewerApproved,
  viewerAskedForChanges,
  viewerHeadReview,
  viewerOwns,
  viewerReviewedHead,
  viewerTeamsMentioned,
  type SpecRequest,
  type SpecTouchKind,
} from './spec-facts.ts';

// ---------------------------------------------------------------------------
// Events as the rules read them
// ---------------------------------------------------------------------------

export function effectiveLoudnessOf(event: PrEvent): Loudness {
  return event.override ? event.override.loudness : event.ruleLoudness;
}

/**
 * Automation made it (a bot account or no actor), unless it is a review
 * request for the viewer or their team: a request counts by whom it asks.
 * The app's own Look closer event has no actor, so it is automation.
 */
export function isAutomationEvent(pr: Pr, viewer: Viewer | null, event: PrEvent): boolean {
  const madeByAutomation = event.isBot || event.actor === '';
  const asksTheViewer = event.kind === 'review_requested' && viewer !== null && asksViewer(viewer, requestSubjectOf(pr, event));
  return madeByAutomation && !asksTheViewer;
}

/** A person's event of `kinds` for the viewer, still loud, and no touch of theirs since; a team mention asks only until seen. */
function isOpenAsk(pr: Pr, viewer: Viewer, event: PrEvent, kinds: readonly EventKind[]): boolean {
  if (!kinds.includes(event.kind) || event.isBot || event.actor === '' || isViewerLogin(viewer, event.actor)) {
    return false;
  }
  if (event.kind === 'team_mention' && event.seenAt !== null) {
    return false;
  }
  const touch = newestTouch(pr, viewer);
  return effectiveLoudnessOf(event) === 'loud' && (touch === null || touch.at <= event.at);
}

/** The newest open ask (the first of two at one instant), or null. */
export function openAsk(pr: Pr, events: PrEvent[], viewer: Viewer, kinds: readonly EventKind[]): PrEvent | null {
  let newest: PrEvent | null = null;
  for (const event of events) {
    if (isOpenAsk(pr, viewer, event, kinds) && (newest === null || event.at > newest.at)) {
      newest = event;
    }
  }
  return newest;
}

// ---------------------------------------------------------------------------
// Whose turn
// ---------------------------------------------------------------------------

/** A move and the footer's words for it (a single-PR tile: no " on #n"); `lead` only for "Waiting on". */
export type ExpectedTurn =
  | { kind: 'you'; move: YourMove; what: string }
  | { kind: 'them'; who: string; what: string; lead?: string }
  | { kind: 'none'; what: '' };

const NONE: ExpectedTurn = { kind: 'none', what: '' };

function you(move: YourMove, what: string): ExpectedTurn {
  return { kind: 'you', move, what };
}

function them(who: string, what: string): ExpectedTurn {
  return { kind: 'them', who, what };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export interface TurnInput {
  pr: Pr;
  events: PrEvent[];
  viewer: Viewer;
  userState: UserPrState | null;
  notYours: boolean;
}

/** How an ask reads alone ("Answer ada's question") and after "Review, ada ..." when a review is owed too. */
const ASK_WORDS: Partial<Record<EventKind, { alone: (actor: string) => string; withReview: string }>> = {
  question_to_user: { alone: (actor) => `Answer ${actor}'s question`, withReview: 'asked you something' },
  mention: { alone: (actor) => `${actor} mentioned you`, withReview: 'mentioned you' },
  reply_to_user: { alone: (actor) => `${actor} replied to you`, withReview: 'replied to you' },
  team_mention: { alone: (actor) => `${actor} mentioned your team`, withReview: 'mentioned your team' },
};

/** Drafts: only a personal ask is a move; on the viewer's own draft also comments and changes to address. */
function draftTurn(input: TurnInput): ExpectedTurn {
  const { pr, viewer } = input;
  const ask = openAsk(pr, input.events, viewer, SPEC_PERSONAL_ASK_KINDS);
  if (ask) {
    return you('reply', `${ASK_WORDS[ask.kind]!.alone(ask.actor)} on draft`);
  }
  if (!viewerOwns(pr, viewer)) {
    return NONE;
  }
  const threads = threadsWaitingOnViewer(pr, viewer);
  if (threads.length > 0) {
    return you('address_changes', `Address ${plural(threads.length, 'comment')} on your draft`);
  }
  const standing = standingChangesBy(pr);
  return standing.length > 0 ? you('address_changes', `Address ${standing[0]}'s changes on your draft`) : NONE;
}

/** "Answer 2 threads", naming the one person the threads wait on when there is one. */
function answerThreads(threads: string[]): string {
  const people = new Set(threads.map((login) => login.toLowerCase()));
  return `Answer ${plural(threads.length, 'thread')}${people.size === 1 ? ` from ${threads[0]}` : ''}`;
}

/**
 * The viewer's own open PR: threads to answer, then changes to address
 * (their reviewers' move once every one was asked again after a push),
 * then waiting on the pending reviewers, then merging an approved PR.
 */
function ownPrTurn(input: TurnInput): ExpectedTurn {
  const { pr, viewer } = input;
  const threads = threadsWaitingOnViewer(pr, viewer);
  if (threads.length > 0) {
    return you('address_changes', answerThreads(threads));
  }
  const standing = standingChangesBy(pr);
  const waiting = standing.find((reviewer) => !askedToReReview(pr, reviewer));
  if (standing.length > 0) {
    return waiting === undefined ? them(standing[0]!, 'to re-review') : you('address_changes', `Address ${waiting}'s changes`);
  }
  const reviewers = [...pr.reviewerUsers, ...pr.reviewerTeams];
  if (reviewers.length > 0) {
    return { kind: 'them', who: reviewers[0]!, what: reviewers.length > 1 ? `and ${reviewers.length - 1} more` : '', lead: 'Waiting on' };
  }
  return pr.reviewDecision === 'APPROVED' ? you('merge', 'Merge, it is approved') : NONE;
}

/** Where the changes requests (other than `except`'s) leave the owner: re-review once every reviewer was asked again, else whose to address first. */
function standingTurn(pr: Pr, except: string | null): ExpectedTurn | null {
  const standing = standingChangesBy(pr).filter((login) => except === null || !sameLogin(login, except));
  if (standing.length === 0) {
    return null;
  }
  const waiting = standing.find((reviewer) => !askedToReReview(pr, reviewer));
  return waiting === undefined ? them(standing[0]!, 'to re-review') : them(namedOwner(pr), `to address ${waiting}'s changes`);
}

/**
 * "Review, ada asked" (the newest person who asked the viewer or their
 * team), "Review for team-platform" (the team whose request decides, home
 * or routing), or with the owner for a teammate's PR.
 */
function reviewWords(pr: Pr, viewer: Viewer, request: SpecRequest, verb: 'Review' | 'Re-review'): string {
  const team = pendingRequestTeam(pr, viewer)?.split('/').pop();
  if (request === 'team') {
    return `${verb} for ${team}`;
  }
  if (request === 'team_for_you') {
    return `${verb} for ${team}: ${namedOwner(pr)}'s PR`;
  }
  const requests = pr.timeline.filter((item) => item.kind === 'review_requested' && asksViewer(viewer, item.subject) && !isAutomationLogin(item.actor));
  const by = requests.toSorted((a, b) => a.at.localeCompare(b.at)).at(-1)?.actor;
  return by !== undefined && !sameLogin(by, viewer.login) ? `${verb}, ${by} asked` : verb;
}

/**
 * Someone else's open PR. An approval stands on any commit. A review is the
 * viewer's move only with a real request (personal, their team on a
 * teammate's PR, or routed and not waiting) and no review of the head; while
 * their changes request stands it is a re-review (2026-09-30), and so is a
 * personal request after a review of the head (asked again without a push).
 */
function othersPrTurn(input: TurnInput): ExpectedTurn {
  const { pr, viewer } = input;
  if (viewerApproved(pr, viewer, input.userState)) {
    return them(namedOwner(pr), 'to merge');
  }
  const headReview = viewerHeadReview(pr, viewer);
  const waits = headReview === null ? routedRequestWaits(pr, viewer, input.notYours) : null;
  if (waits === 'not_yours') {
    return NONE;
  }
  if (waits === 'changes') {
    return standingTurn(pr, viewer.login)!;
  }
  const request = pendingRequest(pr, viewer);
  if (headReview === null && (request === 'you' || request === 'team_for_you' || request === 'team')) {
    return viewerAskedForChanges(pr, viewer) ? you('re_review', reviewWords(pr, viewer, request, 'Re-review')) : you('review', reviewWords(pr, viewer, request, 'Review'));
  }
  if (headReview !== null && request === 'you' && viewerAskedForChanges(pr, viewer)) {
    // Re-requested without a push: a review takes the reviewer off the list, so only the author put them back.
    return you('re_review', reviewWords(pr, viewer, request, 'Re-review'));
  }
  if (headReview !== null) {
    const opened = threadsViewerOpened(pr, viewer);
    if (headReview.state === 'APPROVED') {
      return them(namedOwner(pr), 'to merge');
    }
    if (opened > 0) {
      return them(namedOwner(pr), `to address ${plural(opened, 'thread')}`);
    }
    return them(namedOwner(pr), headReview.state === 'CHANGES_REQUESTED' ? 'to address your changes' : 'to reply');
  }
  if (request === 'team_taken') {
    if (pr.reviewDecision === 'APPROVED') {
      return them(namedOwner(pr), 'to merge');
    }
    const standing = standingChangesBy(pr);
    if (standing.length > 0 && standing.every((reviewer) => askedToReReview(pr, reviewer))) {
      return them(standing[0]!, 'to re-review');
    }
    return them(teamTakers(pr, viewer)[0]!, 'is reviewing');
  }
  return NONE;
}

/**
 * Whose move on one PR and its words: nobody's once merged or closed; on
 * an open PR the author's answer to the viewer's changes request is a
 * re-review (their thread reply included), any other open ask is a reply
 * ("Review, ada asked you something" when a personal review is owed too),
 * and then the rules for own and others' PRs.
 */
export function expectedTurn(input: TurnInput): ExpectedTurn {
  const { pr, viewer } = input;
  if (pr.state !== 'OPEN') {
    return NONE;
  }
  if (pr.isDraft) {
    return draftTurn(input);
  }
  const ask = openAsk(pr, input.events, viewer, SPEC_ADDRESSED_KINDS);
  const answer = changesAnswer(pr, viewer);
  if (answer !== null && (ask === null || isOwner(pr, ask.actor))) {
    const owner = namedOwner(pr);
    return you('re_review', answer.pushed ? `${owner} addressed your changes: re-review` : `${owner} replied to your review`);
  }
  if (ask !== null) {
    const own = viewerOwns(pr, viewer);
    const request = pendingRequest(pr, viewer);
    const reviewToo = !own && (request === 'you' || request === 'team_for_you') && !viewerReviewedHead(pr, viewer, input.userState);
    const words = ASK_WORDS[ask.kind]!;
    return you('reply', reviewToo ? `Review, ${ask.actor} ${words.withReview}` : words.alone(ask.actor));
  }
  return viewerOwns(pr, viewer) ? ownPrTurn(input) : othersPrTurn(input);
}

// ---------------------------------------------------------------------------
// Tier and done
// ---------------------------------------------------------------------------

/**
 * The PR's queue: an unanswered personal ask (not an owner's reply once
 * they answered your changes), your changes request, your PR, a personal
 * request or an open routed one (on a teammate's PR only a routing team's
 * can be), a teammate's PR, a taken request, a team mention, the rest.
 * Your PR and a teammate's go by owners (DESIGN "PR ownership"), and only
 * home teams have teammates (DESIGN "Team roles").
 * Only open PRs have a queue. Drafts and reviewed heads never sit in To review.
 */
export function expectedTier(input: TurnInput & { reason: NotificationReason | null }): PrTier {
  const { pr, viewer } = input;
  if (pr.state !== 'OPEN') {
    return 'rest';
  }
  const ask = openAsk(pr, input.events, viewer, SPEC_PERSONAL_ASK_KINDS);
  if (ask !== null && !(changesAnswer(pr, viewer) !== null && isOwner(pr, ask.actor))) {
    return 'needs_reply';
  }
  if (viewerAskedForChanges(pr, viewer)) {
    return 'changes_requested';
  }
  if (viewerOwns(pr, viewer)) {
    return 'mine';
  }
  const request = pr.isDraft || viewerReviewedHead(pr, viewer, input.userState) ? null : pendingRequest(pr, viewer);
  if (request === 'you' || request === 'team_for_you' || request === 'team') {
    return 'to_review';
  }
  if (teammateOwns(pr, viewer)) {
    return 'team';
  }
  if (request !== null) {
    return 'to_review';
  }
  const teamMentioned = input.reason === 'team_mention' || input.events.some((event) => event.kind === 'team_mention');
  return teamMentioned ? 'team_mentioned' : 'rest';
}

/** A merge without the viewer's review they have not seen; muted counts as seen. */
export function isUnseenMergeWithoutViewer(event: PrEvent): boolean {
  return event.kind === 'merged_without_review' && event.seenAt === null && effectiveLoudnessOf(event) !== 'muted';
}

/**
 * Done (2026-09-28): a merged or closed PR once its merge without the
 * viewer's review is seen (or the glance says not theirs); an open PR only
 * when approved by the viewer, or handled with no review still owed, and
 * in both cases not the viewer's move. Without a viewer, approved in the
 * app or handled is enough.
 */
export function expectedDone(input: Omit<TurnInput, 'viewer'> & { viewer: Viewer | null }): boolean {
  const { pr, viewer, userState } = input;
  if (pr.state !== 'OPEN') {
    return input.notYours || !input.events.some(isUnseenMergeWithoutViewer);
  }
  const notYourMove = () => viewer === null || expectedTurn({ ...input, viewer }).kind !== 'you';
  if (viewerApproved(pr, viewer, userState)) {
    return notYourMove();
  }
  if (!userState?.handledAt) {
    return false;
  }
  return viewer === null || (!reviewStillOwed(pr, viewer, userState, input.notYours) && notYourMove());
}

// ---------------------------------------------------------------------------
// For whom
// ---------------------------------------------------------------------------

/**
 * Which of the viewer's teams a team chip names, home teams first at each
 * step: the team whose pending request decides, a team asked in the
 * timeline, a team mentioned, else their first team. Null without teams.
 */
function chipTeam(pr: Pr, viewer: Viewer): string | null {
  const homeFirst = [...viewer.teams.filter((team) => isHomeTeam(viewer, team)), ...viewer.teams.filter((team) => isRoutingTeam(viewer, team))];
  const pending = pendingRequestTeam(pr, viewer);
  if (pending !== null) {
    return pending;
  }
  const asked = pr.timeline.flatMap((item) => (item.kind === 'review_requested' && item.subject !== null ? [item.subject] : []));
  const timelineTeam = homeFirst.find((team) => asked.some((subject) => sameLogin(subject, team)));
  if (timelineTeam !== undefined) {
    return timelineTeam;
  }
  const mentioned = [pr.body, ...pr.comments.map((comment) => comment.body)].flatMap((body) => viewerTeamsMentioned(body, viewer));
  const mentionedTeam = homeFirst.find((team) => mentioned.some((subject) => sameLogin(subject, team)));
  return mentionedTeam ?? homeFirst[0] ?? null;
}

/**
 * The for-whom chip of one PR (DESIGN "Tile faces", "Team roles"): "Your
 * PR" on one the viewer owns or was notified about as its author; "For
 * you" when the owner answered their changes, a home team request on a
 * teammate's PR is theirs, or the code aims at them (RV, @, AS); a team
 * chip for RT and @T, sea for a home team and neutral for a routing team;
 * else none.
 */
export function expectedForWhom(why: WhyCode, pr: Pr, viewer: Viewer): ForWhom {
  if (why === 'AU' || viewerOwns(pr, viewer)) {
    return { kind: 'own' };
  }
  if (changesAnswer(pr, viewer) !== null || pendingRequest(pr, viewer) === 'team_for_you') {
    return { kind: 'you' };
  }
  if (why === 'RV' || why === '@' || why === 'AS') {
    return { kind: 'you' };
  }
  if (why !== 'RT' && why !== '@T') {
    return { kind: 'none' };
  }
  const team = chipTeam(pr, viewer);
  if (team === null) {
    return { kind: 'team', team: 'your team' };
  }
  const slug = team.split('/').pop()!;
  return isRoutingTeam(viewer, team) ? { kind: 'routing', team: slug } : { kind: 'team', team: slug };
}

/** The tile's chip: the most aimed of its PRs' chips (you, a home team, a routing team, own), the first on a tie. */
export function expectedTileForWhom(chips: ForWhom[]): ForWhom {
  const order: ForWhom['kind'][] = ['you', 'team', 'routing', 'own'];
  for (const kind of order) {
    const chip = chips.find((candidate) => candidate.kind === kind);
    if (chip) {
      return chip;
    }
  }
  return { kind: 'none' };
}

// ---------------------------------------------------------------------------
// Snoozes
// ---------------------------------------------------------------------------

/** Kinds that end a "someone replies" snooze: any person's comment or review. */
const REPLY_KINDS: readonly EventKind[] = [...SPEC_ADDRESSED_KINDS, 'comment', 'review_approved', 'review_changes_requested', 'review_commented'];

/** Made loud by an override, the agent's or the user's. The app's Look closer event is never raised. */
function isRaisedToLoud(event: PrEvent): boolean {
  return event.override?.loudness === 'loud' && event.kind !== 'look_closer';
}

/**
 * broken: unseen loud news after the start, from a person, or automation
 * the agent raised to loud (2026-09-30; the app's Look closer event never).
 * over: the PR merged or closed (every kind, 2026-09-30), or the condition
 * met. active otherwise.
 */
export function expectedSnoozePhase(input: { pr: Pr; events: PrEvent[]; viewer: Viewer; snooze: Snooze; now: IsoTime }): 'active' | 'broken' | 'over' {
  const { pr, events, viewer, snooze } = input;
  const after = events.filter((event) => event.at > snooze.since);
  const wakes = (event: PrEvent) =>
    event.seenAt === null && effectiveLoudnessOf(event) === 'loud' && (!isAutomationEvent(pr, viewer, event) || isRaisedToLoud(event));
  if (after.some(wakes)) {
    return 'broken';
  }
  if (pr.state !== 'OPEN') {
    return 'over';
  }
  const condition = snooze.condition;
  switch (condition.kind) {
    case 'someone_replies':
      return after.some((event) => REPLY_KINDS.includes(event.kind) && !isAutomationEvent(pr, viewer, event) && !isViewerLogin(viewer, event.actor)) ? 'over' : 'active';
    case 'new_push':
      return after.some((event) => SPEC_PUSH_KINDS.includes(event.kind)) ? 'over' : 'active';
    case 'ci_green':
      return pr.checks.rollup === 'SUCCESS' ? 'over' : 'active';
    case 'until_time':
      return input.now >= condition.until ? 'over' : 'active';
  }
}

// ---------------------------------------------------------------------------
// Pings
// ---------------------------------------------------------------------------

/**
 * Loud and about the viewer in person: on an open draft only a personal ask;
 * else any ask, and on an open PR a review request, a push after their
 * approval, the author's answer to their changes, or a changes request on
 * their own PR.
 */
export function isAimedAtViewer(pr: Pr, viewer: Viewer, event: PrEvent): boolean {
  if (effectiveLoudnessOf(event) !== 'loud') {
    return false;
  }
  if (pr.isDraft && pr.state === 'OPEN') {
    return SPEC_PERSONAL_ASK_KINDS.includes(event.kind);
  }
  if (SPEC_ADDRESSED_KINDS.includes(event.kind)) {
    return true;
  }
  if (pr.state !== 'OPEN') {
    return false;
  }
  if (answersChanges(pr, viewer, event)) {
    return true;
  }
  if (event.kind === 'review_requested' || event.kind === 'commits_after_approval') {
    return true;
  }
  return event.kind === 'review_changes_requested' && viewerOwns(pr, viewer);
}

/** A request for one of the viewer's teams (not the viewer) that is routed: a routing team's, or a home team's on a PR from outside the team. */
export function isRoutedRequest(pr: Pr, viewer: Viewer, event: PrEvent): boolean {
  if (event.kind !== 'review_requested') {
    return false;
  }
  const subject = requestSubjectOf(pr, event);
  return subject !== null && !sameLogin(subject, viewer.login) && isRoutedTeam(pr, viewer, subject);
}

export interface ExpectedPing {
  class: PingRuleClass;
  eventId: string | null;
  /** The table row's own reason, else the event's (override first). */
  reason: string;
}

/**
 * The ping class of a PR's new events, most aimed first (DESIGN "Live poll
 * and Mac pings"): nothing new, a quiet repo, a snoozed tile, only
 * automation at its rule's loudness, aimed at the viewer (routed team requests wait for Look
 * closer), loud, quiet, muted. Within a class the newest event.
 */
export function expectedPing(input: { pr: Pr; events: PrEvent[]; viewer: Viewer; quietRepo: boolean; snoozed: boolean }): ExpectedPing {
  const { pr, viewer } = input;
  const newestFirst = input.events.toSorted((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  const about = (pingClass: PingRuleClass, event: PrEvent, reason?: string): ExpectedPing => ({
    class: pingClass,
    eventId: event.id,
    reason: reason ?? event.override?.reason ?? event.ruleReason,
  });
  const newest = newestFirst[0];
  if (newest === undefined) {
    return { class: 'quiet', eventId: null, reason: 'no new events' };
  }
  if (input.quietRepo) {
    return about('quiet_repo', newest, 'quiet repo (let it go stale)');
  }
  if (input.snoozed) {
    return about('snoozed', newest, 'tile snoozed');
  }
  // Automation raised to loud counts like a person's loud event (2026-09-30).
  if (newestFirst.every((event) => isAutomationEvent(pr, viewer, event) && !isRaisedToLoud(event))) {
    return about('bot', newest);
  }
  const aimed = newestFirst.filter((event) => isAimedAtViewer(pr, viewer, event));
  const addressed = aimed.find((event) => !isRoutedRequest(pr, viewer, event));
  if (addressed) {
    return about('addressed', addressed);
  }
  if (aimed[0]) {
    return about('routed', aimed[0], 'review routed to your team: pings when the glance says Look closer');
  }
  const loud = newestFirst.find((event) => effectiveLoudnessOf(event) === 'loud');
  if (loud) {
    return about('not_addressed', loud);
  }
  const quiet = newestFirst.find((event) => effectiveLoudnessOf(event) === 'quiet');
  return quiet ? about('quiet', quiet) : about('muted', newest);
}

/** "acme/app#12" -> "app#12". */
function shortKey(key: PrKey): string {
  return key.slice(key.indexOf('/') + 1);
}

const HEADLINES: Partial<Record<EventKind, string>> = {
  mention: 'mentioned you',
  team_mention: 'mentioned your team',
  question_to_user: 'asked you something',
  reply_to_user: 'replied to you',
  review_changes_requested: 'requested changes',
};

/** What the ping says about an event when the agent does not write it: who did what, then the PR. */
function pingHeadline(pr: Pr, event: PrEvent): string {
  const who = `@${event.actor}`;
  if (event.ruleReason === 'addressed your changes') {
    return `${who} addressed your changes`;
  }
  if (event.kind === 'review_requested') {
    // A bot's request says what it asks, not which bot clicked it.
    const subject = requestSubjectOf(pr, event);
    if (!event.isBot) {
      return `${who} asked for your review`;
    }
    return subject !== null && subject.includes('/') ? `Review requested for ${subject.split('/').pop()}` : 'Review requested from you';
  }
  if (event.kind === 'commits_after_approval') {
    return 'New commits after your approval';
  }
  const headline = HEADLINES[event.kind];
  return headline ? `${who} ${headline}` : `${who}: ${event.kind.replaceAll('_', ' ')}`;
}

/** The ping's fallback text: headline and PR, then the PR title and the event's line (both short on these boards). */
export function expectedPingText(pr: Pr, event: PrEvent): { title: string; body: string } {
  return { title: `${pingHeadline(pr, event)} · ${shortKey(pr.key)}`, body: `${pr.title}\n${event.summary}` };
}

// ---------------------------------------------------------------------------
// Look closer pings
// ---------------------------------------------------------------------------

/** "acme/team-platform" -> "team-platform". */
function slug(team: string): string {
  return team.split('/').pop()!.toLowerCase();
}

/**
 * A routed team request pings once when the glance says Look closer: an
 * open non-draft PR with a routed request pending (a routing team's on
 * anyone else's PR, a home team's on a PR from outside the team), the head not reviewed, no snooze, and not for the same request
 * again (the newest timeline request for that team, else `pending:<team>`).
 */
export function expectedLookCloser(input: {
  pr: Pr;
  viewer: Viewer;
  verdict: Verdict | null;
  userState: UserPrState | null;
  snoozed: boolean;
  pingedRequestId: string | null;
}): LookCloserPing {
  const { pr, viewer } = input;
  if (input.verdict !== 'LOOK_CLOSER') {
    return { kind: 'skip', why: 'not_look_closer' };
  }
  const team = pr.state === 'OPEN' && !pr.isDraft ? pr.reviewerTeams.find((subject) => isRoutedTeam(pr, viewer, subject)) : undefined;
  if (team === undefined) {
    return { kind: 'skip', why: 'no_routed_request' };
  }
  if (viewerReviewedHead(pr, viewer, input.userState)) {
    return { kind: 'skip', why: 'reviewed' };
  }
  if (input.snoozed) {
    return { kind: 'skip', why: 'snoozed' };
  }
  const requests = pr.timeline.filter((item) => item.kind === 'review_requested' && item.subject !== null && slug(item.subject) === slug(team));
  const requestId = requests.toSorted((a, b) => a.at.localeCompare(b.at)).at(-1)?.id ?? `pending:${team}`;
  if (input.pingedRequestId === requestId) {
    return { kind: 'skip', why: 'already_pinged' };
  }
  return { kind: 'ping', team, requestId };
}

/** The Look closer ping's text: team and PR, then the PR title and the first sentence of the glance's for-you line. */
export function expectedLookCloserText(pr: Pr, team: string, firstSentence: string): { title: string; body: string } {
  return { title: `Look closer: review for ${slug(team)} · ${shortKey(pr.key)}`, body: `${pr.title}\n${firstSentence}` };
}

// ---------------------------------------------------------------------------
// Quiet reads
// ---------------------------------------------------------------------------

/** Ten minutes after the newest activity, so a person answering the bot right away still counts. */
const GRACE_MS = 10 * 60_000;

function withinGrace(now: IsoTime, times: IsoTime[]): boolean {
  const newest = times.toSorted().at(-1)!;
  return new Date(now).getTime() - new Date(newest).getTime() < GRACE_MS;
}

/** The snapshot vouches for the thread: complete, and fetched at or after the thread's last update. */
export function snapshotIsFresh(thread: NotificationThread, prFetchedAt: IsoTime | null, truncated: boolean): boolean {
  return !truncated && prFetchedAt !== null && prFetchedAt >= thread.updatedAt;
}

export interface QuietReadSpecInput {
  thread: NotificationThread;
  pr: Pr;
  events: PrEvent[];
  viewer: Viewer;
  /** Whose move on the PR is the viewer's. */
  yourMove: boolean;
  prFetchedAt: IsoTime | null;
  now: IsoTime;
}

function othersEvents(input: Pick<QuietReadSpecInput, 'events' | 'viewer'>): PrEvent[] {
  return input.events.filter((event) => !isViewerLogin(input.viewer, event.actor));
}

/** Loud as the agent or user left it, and not seen. */
function isUnseenLoudEvent(event: PrEvent): boolean {
  return event.seenAt === null && effectiveLoudnessOf(event) === 'loud';
}

/** Who acted, in order of first appearance, "CI" for actor-less events. */
function actorNames(events: PrEvent[]): string[] {
  return [...new Set(events.map((event) => (event.actor === '' ? 'CI' : event.actor)))];
}

function isOwnOpenPr(pr: Pr, viewer: Viewer): boolean {
  return pr.state === 'OPEN' && viewerOwns(pr, viewer);
}

/**
 * "Handled quietly", bots only (DESIGN): a thread the viewer had read that
 * turned unread only because of automation, on a fresh complete snapshot,
 * not their own open PR, no unseen merge without their review, no unseen
 * loud news on the PR, not their move, and past the grace. Whether the tile
 * is unread never matters: its thread is unread, so it always is. Liveness
 * too: all of that holds, so it marks.
 */
export function expectedQuietRead(input: QuietReadSpecInput): QuietReadCheck {
  const { thread, pr, viewer } = input;
  if (!thread.unread) {
    return { kind: 'skip', why: 'not_unread' };
  }
  if (thread.lastReadAt === null) {
    return { kind: 'skip', why: 'never_read' };
  }
  if (!snapshotIsFresh(thread, input.prFetchedAt, pr.truncated === true)) {
    return { kind: 'skip', why: 'stale_snapshot' };
  }
  const readAt = thread.lastReadAt;
  const since = othersEvents(input).filter((event) => event.at > readAt);
  if (since.length === 0 || !since.every((event) => isAutomationEvent(pr, viewer, event))) {
    return { kind: 'skip', why: 'human_activity' };
  }
  if (isOwnOpenPr(pr, viewer)) {
    return { kind: 'skip', why: 'own_pr' };
  }
  if (input.events.some(isUnseenMergeWithoutViewer)) {
    return { kind: 'skip', why: 'unseen_merge' };
  }
  if (input.events.some(isUnseenLoudEvent)) {
    return { kind: 'skip', why: 'unseen_loud' };
  }
  if (input.yourMove) {
    return { kind: 'skip', why: 'your_move' };
  }
  if (withinGrace(input.now, [thread.updatedAt, ...since.map((event) => event.at)])) {
    return { kind: 'skip', why: 'grace' };
  }
  return { kind: 'mark', bots: actorNames(since) };
}

const TOUCH_REASONS: Partial<Record<SpecTouchKind, 'approved' | 'changes_requested' | 'reviewed' | 'replied'>> = {
  approval: 'approved',
  changes_request: 'changes_requested',
  review: 'reviewed',
  comment: 'replied',
};

/**
 * "You already dealt with it": the viewer reviewed or commented after every
 * unread event (bots after it are fine, except on their own open PR), on a
 * fresh complete snapshot, no unseen merge without their review after the
 * touch, no unseen loud news on the PR, and past the grace.
 */
export function expectedTouchedRead(input: Omit<QuietReadSpecInput, 'yourMove'>): TouchedReadCheck {
  const { thread, pr, viewer } = input;
  if (!thread.unread) {
    return { kind: 'skip', why: 'not_unread' };
  }
  if (!snapshotIsFresh(thread, input.prFetchedAt, pr.truncated === true)) {
    return { kind: 'skip', why: 'stale_snapshot' };
  }
  const touch = newestTouch(pr, viewer, READING_TOUCHES);
  if (touch === null) {
    return { kind: 'skip', why: 'no_touch' };
  }
  const readAt = thread.lastReadAt;
  const unread = othersEvents(input).filter((event) => readAt === null || event.at > readAt);
  if (unread.length === 0) {
    return { kind: 'skip', why: 'nothing_known' };
  }
  const late = unread.filter((event) => event.at > touch.at);
  if (!late.every((event) => isAutomationEvent(pr, viewer, event))) {
    return { kind: 'skip', why: 'activity_after' };
  }
  if (late.length > 0 && isOwnOpenPr(pr, viewer)) {
    return { kind: 'skip', why: 'own_pr' };
  }
  if (input.events.some((event) => isUnseenMergeWithoutViewer(event) && event.at > touch.at)) {
    return { kind: 'skip', why: 'unseen_merge' };
  }
  if (input.events.some(isUnseenLoudEvent)) {
    return { kind: 'skip', why: 'unseen_loud' };
  }
  if (withinGrace(input.now, [thread.updatedAt, touch.at, ...late.map((event) => event.at)])) {
    return { kind: 'skip', why: 'grace' };
  }
  return { kind: 'mark', reason: TOUCH_REASONS[touch.kind]! };
}

/**
 * An ask of the viewer (DESIGN "GitHub unread is PostPile unread": never
 * clearable by itself): a mention, team mention (of a home team), question
 * or reply to them, a review request naming them or their team (whoever
 * made it), a merge without their review they have not seen. Whatever the
 * agent made of it.
 */
export function isAskEvent(pr: Pr, viewer: Viewer, event: PrEvent): boolean {
  if (event.kind === 'team_mention') {
    // A mention of only routing teams is FYI (DESIGN "Team roles").
    const body = pr.comments.find((comment) => comment.id === event.sourceId)?.body ?? '';
    return !mentionsOnlyRoutingTeams(body, viewer);
  }
  if (SPEC_ADDRESSED_KINDS.includes(event.kind)) {
    return true;
  }
  if (event.kind === 'review_requested') {
    return asksViewer(viewer, requestSubjectOf(pr, event));
  }
  return isUnseenMergeWithoutViewer(event);
}

/** The newer of GitHub's read time and the viewer's last review or comment; null when neither exists. */
export function lastLooked(thread: NotificationThread, pr: Pr, viewer: Viewer): IsoTime | null {
  const touch = newestTouch(pr, viewer, READING_TOUCHES);
  const times = [thread.lastReadAt, touch?.at ?? null].filter((time): time is IsoTime => time !== null);
  return times.toSorted().at(-1) ?? null;
}

/**
 * "GitHub unread is PostPile unread" (2026-09-30): everything by someone
 * else since the viewer last looked is automation or a person's activity
 * the events agent (or the user) left below loud, with no ask among it and
 * no loud news; at least one person, else the bot-only and acted-after
 * rules decide. Plus the safety checks: fresh complete snapshot, no bots on
 * the viewer's own open PR, no unseen merge without their review, not their
 * move, past the grace. Liveness too: all of that holds, so it marks.
 */
export function expectedJudgedRead(input: QuietReadSpecInput): JudgedReadCheck {
  const { thread, pr, viewer } = input;
  if (!thread.unread) {
    return { kind: 'skip', why: 'not_unread' };
  }
  if (!snapshotIsFresh(thread, input.prFetchedAt, pr.truncated === true)) {
    return { kind: 'skip', why: 'stale_snapshot' };
  }
  const since = lastLooked(thread, pr, viewer);
  if (since === null) {
    return { kind: 'skip', why: 'never_looked' };
  }
  const after = othersEvents(input).filter((event) => event.at > since);
  if (after.length === 0) {
    return { kind: 'skip', why: 'nothing_known' };
  }
  if (after.some((event) => isAskEvent(pr, viewer, event))) {
    return { kind: 'skip', why: 'asks_you' };
  }
  if (input.events.some(isUnseenLoudEvent) || after.some((event) => effectiveLoudnessOf(event) === 'loud')) {
    return { kind: 'skip', why: 'unseen_loud' };
  }
  const people = after.filter((event) => !isAutomationEvent(pr, viewer, event));
  if (people.length === 0) {
    return { kind: 'skip', why: 'no_people' };
  }
  if (!people.every((event) => event.override !== null && event.override.loudness !== 'loud')) {
    return { kind: 'skip', why: 'not_judged' };
  }
  if (people.length < after.length && isOwnOpenPr(pr, viewer)) {
    return { kind: 'skip', why: 'own_pr' };
  }
  if (input.events.some(isUnseenMergeWithoutViewer)) {
    return { kind: 'skip', why: 'unseen_merge' };
  }
  if (input.yourMove) {
    return { kind: 'skip', why: 'your_move' };
  }
  if (withinGrace(input.now, [thread.updatedAt, since, ...after.map((event) => event.at)])) {
    return { kind: 'skip', why: 'grace' };
  }
  return { kind: 'mark', actors: actorNames(after) };
}

/**
 * Opening a PR in PostPile reads it only where that hides nothing: it has
 * a thread and a tile, no tile holding it is snoozed, a mark-read leaves it
 * done; an unread thread also needs a fresh complete snapshot.
 */
export function expectedOpenedRead(input: { thread: NotificationThread | null; prFetchedAt: IsoTime | null; truncated: boolean; tilesSnoozed: boolean[]; doneAfterRead: boolean }): OpenedReadCheck {
  if (input.thread === null) {
    return { kind: 'skip', why: 'no_thread' };
  }
  if (input.tilesSnoozed.length === 0) {
    return { kind: 'skip', why: 'no_tile' };
  }
  if (input.tilesSnoozed.some((snoozed) => snoozed)) {
    return { kind: 'skip', why: 'snoozed' };
  }
  if (!input.doneAfterRead) {
    return { kind: 'skip', why: 'asks_you' };
  }
  if (!input.thread.unread) {
    return { kind: 'handle' };
  }
  return snapshotIsFresh(input.thread, input.prFetchedAt, input.truncated) ? { kind: 'mark' } : { kind: 'skip', why: 'stale_snapshot' };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ExpectedReadPlan {
  seenAt: IsoTime;
  handledAt: IsoTime;
  handleKeys: PrKey[];
  eventIds: string[];
  handledKeys: PrKey[];
}

/**
 * One read (DESIGN "Reading a PR is one planner"): every unseen event of the
 * scope turns seen, up to the cause's cutoff (GitHub's read time, the click
 * of a pending read); the button, opening and a completed pending read
 * handle the scope's tracked PRs (an earlier handled time stays); GitHub's
 * and quiet reads stamp their own read time.
 */
export function expectedReadPlan(input: { scope: ReadScope; cause: ReadCause; events: ReadonlyMap<PrKey, PrEvent[]>; userStates: ReadonlyMap<PrKey, UserPrState>; at: IsoTime }): ExpectedReadPlan {
  const { cause } = input;
  let cutoff: IsoTime | null = null;
  if (cause.kind === 'pending_completion') {
    cutoff = cause.clickedAt;
  }
  if (cause.kind === 'read_on_github' || cause.kind === 'quiet') {
    cutoff = cause.readAt;
  }
  const handles = cause.kind === 'button' || cause.kind === 'opened' || cause.kind === 'pending_completion';
  const eventIds = input.scope.prKeys.flatMap((key) =>
    (input.events.get(key) ?? []).filter((event) => event.seenAt === null && (cutoff === null || event.at <= cutoff)).map((event) => event.id),
  );
  const handleKeys = handles ? input.scope.handleKeys.filter((key) => input.scope.prKeys.includes(key)) : [];
  const stampsReadTime = cause.kind === 'read_on_github' || cause.kind === 'quiet';
  return {
    seenAt: stampsReadTime ? cutoff! : input.at,
    handledAt: input.at,
    handleKeys,
    eventIds,
    handledKeys: handleKeys.filter((key) => !input.userStates.get(key)?.handledAt),
  };
}

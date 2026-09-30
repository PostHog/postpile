// The rules restated from the spec (DESIGN "Whose turn", "Rules layer: one
// home per fact", "Handled quietly", "Live poll and Mac pings", "Look closer
// pings", "Reading a PR is one planner"), over the raw snapshot and the
// board's events. The event invariant checks the events themselves against
// the snapshot (spec-events.ts), so these read an event's kind, actor, time
// and loudness, never a rule's answer about it. Each function says what the
// app should do; the invariants compare the app's answer with it. Type
// imports only from the rule modules.
import type { LookCloserPing } from '../glance-pings.ts';
import { sameLogin } from '../mentions.ts';
import type { PingRuleClass } from '../pings.ts';
import type { PrTier } from '../pr-tier.ts';
import type { OpenedReadCheck, QuietReadCheck, TouchedReadCheck } from '../quiet-reads.ts';
import type { ReadCause, ReadScope } from '../read-plan.ts';
import type { EventKind, IsoTime, Loudness, NotificationReason, NotificationThread, Pr, PrEvent, PrKey, Snooze, UserPrState, Verdict, Viewer } from '../types.ts';
import type { YourMove } from '../whose-turn.ts';
import { answersChanges, SPEC_ADDRESSED_KINDS, SPEC_PERSONAL_ASK_KINDS, SPEC_PUSH_KINDS } from './spec-events.ts';
import {
  askedToReReview,
  asksViewer,
  changesAnswer,
  isAutomationLogin,
  isKnownTeammate,
  isViewerLogin,
  isViewerTeam,
  newestTouch,
  pendingRequest,
  READING_TOUCHES,
  requestSubjectOf,
  reviewStillOwed,
  routedRequestWaits,
  standingChangesBy,
  teamTakers,
  threadsViewerOpened,
  threadsWaitingOnViewer,
  viewerApproved,
  viewerAskedForChanges,
  viewerHeadReview,
  viewerReviewedHead,
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
  if (!sameLogin(pr.author, viewer.login)) {
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

/** Where the changes requests (other than `except`'s) leave the author: re-review once every reviewer was asked again, else whose to address first. */
function standingTurn(pr: Pr, except: string | null): ExpectedTurn | null {
  const standing = standingChangesBy(pr).filter((login) => except === null || !sameLogin(login, except));
  if (standing.length === 0) {
    return null;
  }
  const waiting = standing.find((reviewer) => !askedToReReview(pr, reviewer));
  return waiting === undefined ? them(standing[0]!, 'to re-review') : them(pr.author, `to address ${waiting}'s changes`);
}

/** "Review, ada asked" (the newest person who asked the viewer or their team), "Review for team-platform", or with the author for a teammate's PR. */
function reviewWords(pr: Pr, viewer: Viewer, request: SpecRequest, verb: 'Review' | 'Re-review'): string {
  const team = pr.reviewerTeams.find((subject) => isViewerTeam(viewer, subject))?.split('/').pop();
  if (request === 'team') {
    return `${verb} for ${team}`;
  }
  if (request === 'team_for_you') {
    return `${verb} for ${team}: ${pr.author}'s PR`;
  }
  const requests = pr.timeline.filter((item) => item.kind === 'review_requested' && asksViewer(viewer, item.subject) && !isAutomationLogin(item.actor));
  const by = requests.toSorted((a, b) => a.at.localeCompare(b.at)).at(-1)?.actor;
  return by !== undefined && !sameLogin(by, viewer.login) ? `${verb}, ${by} asked` : verb;
}

/**
 * Someone else's open PR. An approval stands on any commit. A review is the
 * viewer's move only with a real request (personal, their team on a
 * teammate's PR, or routed and not waiting) and no review of the head; while
 * their changes request stands it is a re-review (2026-09-30).
 */
function othersPrTurn(input: TurnInput): ExpectedTurn {
  const { pr, viewer } = input;
  if (viewerApproved(pr, viewer, input.userState)) {
    return them(pr.author, 'to merge');
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
  if (headReview !== null) {
    const opened = threadsViewerOpened(pr, viewer);
    if (headReview.state === 'APPROVED') {
      return them(pr.author, 'to merge');
    }
    if (opened > 0) {
      return them(pr.author, `to address ${plural(opened, 'thread')}`);
    }
    return them(pr.author, headReview.state === 'CHANGES_REQUESTED' ? 'to address your changes' : 'to reply');
  }
  if (request === 'team_taken') {
    if (pr.reviewDecision === 'APPROVED') {
      return them(pr.author, 'to merge');
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
  if (answer !== null && (ask === null || sameLogin(ask.actor, pr.author))) {
    return you('re_review', answer.pushed ? `${pr.author} addressed your changes: re-review` : `${pr.author} replied to your review`);
  }
  if (ask !== null) {
    const own = sameLogin(pr.author, viewer.login);
    const request = pendingRequest(pr, viewer);
    const reviewToo = !own && (request === 'you' || request === 'team_for_you') && !viewerReviewedHead(pr, viewer, input.userState);
    const words = ASK_WORDS[ask.kind]!;
    return you('reply', reviewToo ? `Review, ${ask.actor} ${words.withReview}` : words.alone(ask.actor));
  }
  return sameLogin(pr.author, viewer.login) ? ownPrTurn(input) : othersPrTurn(input);
}

// ---------------------------------------------------------------------------
// Tier and done
// ---------------------------------------------------------------------------

/**
 * The PR's queue: an unanswered personal ask (not the author's reply once
 * they answered your changes), your changes request, your PR, a personal
 * request, a teammate's PR, any other request, a team mention, the rest.
 * Only open PRs have a queue. Drafts and reviewed heads never sit in To review.
 */
export function expectedTier(input: TurnInput & { reason: NotificationReason | null }): PrTier {
  const { pr, viewer } = input;
  if (pr.state !== 'OPEN') {
    return 'rest';
  }
  const ask = openAsk(pr, input.events, viewer, SPEC_PERSONAL_ASK_KINDS);
  if (ask !== null && !(changesAnswer(pr, viewer) !== null && sameLogin(ask.actor, pr.author))) {
    return 'needs_reply';
  }
  if (viewerAskedForChanges(pr, viewer)) {
    return 'changes_requested';
  }
  if (sameLogin(pr.author, viewer.login)) {
    return 'mine';
  }
  const request = pr.isDraft || viewerReviewedHead(pr, viewer, input.userState) ? null : pendingRequest(pr, viewer);
  if (request === 'you' || request === 'team_for_you') {
    return 'to_review';
  }
  if (isKnownTeammate(viewer, pr.author)) {
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
// Snoozes
// ---------------------------------------------------------------------------

/** Kinds that end a "someone replies" snooze: any person's comment or review. */
const REPLY_KINDS: readonly EventKind[] = [...SPEC_ADDRESSED_KINDS, 'comment', 'review_approved', 'review_changes_requested', 'review_commented'];

/**
 * broken: unseen loud news after the start, from a person, or automation
 * the agent raised to loud (2026-09-30; the app's Look closer event never).
 * over: the PR merged or closed (every kind, 2026-09-30), or the condition
 * met. active otherwise.
 */
export function expectedSnoozePhase(input: { pr: Pr; events: PrEvent[]; viewer: Viewer; snooze: Snooze; now: IsoTime }): 'active' | 'broken' | 'over' {
  const { pr, events, viewer, snooze } = input;
  const after = events.filter((event) => event.at > snooze.since);
  const wakes = (event: PrEvent) => {
    const raised = event.override?.loudness === 'loud' && event.kind !== 'look_closer';
    return event.seenAt === null && effectiveLoudnessOf(event) === 'loud' && (!isAutomationEvent(pr, viewer, event) || raised);
  };
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
  return event.kind === 'review_changes_requested' && sameLogin(pr.author, viewer.login);
}

/** A request for one of the viewer's teams (not the viewer) on a PR from outside the team. */
export function isRoutedRequest(pr: Pr, viewer: Viewer, event: PrEvent): boolean {
  if (event.kind !== 'review_requested' || sameLogin(pr.author, viewer.login) || isKnownTeammate(viewer, pr.author)) {
    return false;
  }
  const subject = requestSubjectOf(pr, event);
  return subject !== null && !sameLogin(subject, viewer.login) && isViewerTeam(viewer, subject);
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
 * automation, aimed at the viewer (routed team requests wait for Look
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
  if (newestFirst.every((event) => isAutomationEvent(pr, viewer, event))) {
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
 * open non-draft PR from outside the team with one of the viewer's teams
 * pending, the head not reviewed, no snooze, and not for the same request
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
  const outside = !sameLogin(pr.author, viewer.login) && !isKnownTeammate(viewer, pr.author);
  const team = pr.state === 'OPEN' && !pr.isDraft && outside ? pr.reviewerTeams.find((subject) => isViewerTeam(viewer, subject)) : undefined;
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
  tileUnread: boolean;
  /** Whose move on the PR is the viewer's. */
  yourMove: boolean;
  prFetchedAt: IsoTime | null;
  now: IsoTime;
}

function othersEvents(input: QuietReadSpecInput): PrEvent[] {
  return input.events.filter((event) => !isViewerLogin(input.viewer, event.actor));
}

function isOwnOpenPr(pr: Pr, viewer: Viewer): boolean {
  return pr.state === 'OPEN' && sameLogin(pr.author, viewer.login);
}

/**
 * "Handled quietly", bots only (DESIGN): a thread the viewer had read that
 * turned unread only because of automation, on a fresh complete snapshot,
 * not their own open PR, no unseen merge without their review, the tile not
 * unread, not their move, and past the grace. Liveness too: all of that
 * holds, so it marks.
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
  if (input.tileUnread) {
    return { kind: 'skip', why: 'tile_unread' };
  }
  if (input.yourMove) {
    return { kind: 'skip', why: 'your_move' };
  }
  if (withinGrace(input.now, [thread.updatedAt, ...since.map((event) => event.at)])) {
    return { kind: 'skip', why: 'grace' };
  }
  return { kind: 'mark', bots: [...new Set(since.map((event) => (event.actor === '' ? 'CI' : event.actor)))] };
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
 * touch, the tile not unread, and past the grace.
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
  const unread = othersEvents({ ...input, yourMove: false }).filter((event) => readAt === null || event.at > readAt);
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
  if (input.tileUnread) {
    return { kind: 'skip', why: 'tile_unread' };
  }
  if (withinGrace(input.now, [thread.updatedAt, touch.at, ...late.map((event) => event.at)])) {
    return { kind: 'skip', why: 'grace' };
  }
  return { kind: 'mark', reason: TOUCH_REASONS[touch.kind]! };
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

// "Handled quietly": a PR thread the user had read that turned unread again
// only because of bots (merge queue, review bots, deploys). PostPile marks
// it read on GitHub by itself when nothing is asked of the user. A second
// reason: the user acted on the PR after every unread event ("You already
// dealt with it"); a third: everything since they last looked is automation
// or a person's activity the events agent judged as not needing them ("GitHub
// unread is PostPile unread"); a fourth, opening the PR in PostPile, is
// decided by the engine from the tile; a fifth: a review request the user
// never opened that no longer stands, with nothing since that needs them.
// Notifications that are not PRs (releases, issues) are marked read too.
// Rules only, no IO. DESIGN.md "Handled quietly", "You already dealt with
// it" and "GitHub unread is PostPile unread" have the reasons behind each
// rule.
//
// A thread unread on GitHub keeps its tile unread until one of these clears
// it, so none of them may look at whether the tile is unread (it always is).
// The safety check that stands in for that is `unseen_loud`: no unseen loud
// event on the PR.

import { isAutomation } from './bots.ts';
import type { NotificationLanding } from './debug-views.ts';
import { editMentionOf, isRoutingTeamMention } from './events.ts';
import { ADDRESSED_KINDS, PUSH_KINDS } from './kinds.ts';
import { isOwnEvent, lastTouch, READING_TOUCH_KINDS, type TouchKind } from './last-touch.ts';
import { effectiveLoudness, isUnseenLoud, isUnseenMergeWithoutReview } from './loudness.ts';
import { isViewerSubject } from './mentions.ts';
import { eventsAsOf, prAsOf, userStateAsOf } from './pr-as-of.ts';
import { reviewRequest, reviewRequestTarget, teamRequestTakenBy } from './review-request.ts';
import { sawEverythingBefore } from './saw-before-acting.ts';
import { snapshotCoversSince } from './snapshot-coverage.ts';
import type { EventKind, IsoTime, NotificationThread, Pr, PrEvent, PrKey, UserPrState, Viewer } from './types.ts';
import { prWhoseTurn } from './whose-turn.ts';

/** How far back the "Handled quietly" view looks. */
export const HANDLED_QUIETLY_DAYS = 7;

/** Threads one run marks read at most; the rest wait for the next run. */
export const QUIET_READS_PER_RUN = 50;

/** Name shown for activity without an actor (GitHub itself; CI results had none until 0.21.0). */
export const NO_ACTOR_NAME = 'GitHub';

/**
 * Automation by the shared rule (`isAutomation`): a bot-made review request
 * that asks the viewer or their team is a person's ask, not bot activity.
 */
function isAutomationOn(event: PrEvent, pr: Pr, viewer: Viewer): boolean {
  return isAutomation(event, reviewRequestTarget(event, pr), viewer);
}

/**
 * The events by someone else after the thread's last read, when every one of
 * them is automation. The viewer's own events (a review from the CLI) are not
 * someone else's activity and are left out. Null when a person took part, or
 * when nothing by someone else after the read is known (the thread turned
 * unread for a reason the app cannot see).
 */
export function botOnlySinceRead(pr: Pr, events: PrEvent[], lastReadAt: IsoTime, viewer: Viewer): PrEvent[] | null {
  const since = events.filter((event) => event.at > lastReadAt && !isOwnEvent(event, viewer));
  if (since.length === 0 || !since.every((event) => isAutomationOn(event, pr, viewer))) {
    return null;
  }
  return since;
}

/** The bots behind the events, in order of first appearance, "GitHub" for actor-less ones. */
export function botNames(events: PrEvent[]): string[] {
  return [...new Set(events.map((event) => (event.actor === '' ? NO_ACTOR_NAME : event.actor)))];
}

/**
 * Why a thread is left alone:
 * - not_unread: GitHub has it read already
 * - never_read: the user never read it (no last_read_at), so it is not "back" because of bots
 * - stale_snapshot: the stored PR snapshot is older than the thread's last update (a PR the
 *   sync left out at its cap, or whose fetch failed), or the query's caps cut it inside the
 *   unread interval (`snapshotCoversSince`), so a person's comment may be missing
 * - human_activity: someone else did something since the last read, or nothing known happened
 * - unseen_merge: a merge without the user's review is never marked read by PostPile
 * - unseen_loud: the PR has unseen loud news (an automation event the agent raised, the app's Look closer)
 * - your_move: whose turn is the user's, and it was not before their last read (`isNewYourMove`)
 */
export type QuietSkip = 'not_unread' | 'never_read' | 'stale_snapshot' | 'human_activity' | 'unseen_merge' | 'unseen_loud' | 'your_move';

export type QuietReadCheck = { kind: 'mark'; bots: string[] } | { kind: 'skip'; why: QuietSkip };

export interface QuietReadInput {
  thread: NotificationThread;
  pr: Pr;
  events: PrEvent[];
  userState: UserPrState | null;
  viewer: Viewer;
  /** The PR's glance says NOT_YOURS; whose turn reads it the same way the tile does. */
  notYours: boolean;
  /** When the stored PR snapshot was fetched; null when unknown. */
  prFetchedAt: IsoTime | null;
}

/**
 * The stored events can only vouch for the unread interval from `since`
 * when the snapshot was fetched at or after the thread's last update, and
 * reaches back to `since` past the query's caps. A sync refreshes every
 * thread but may leave a PR out (its cap, a failed fetch): then the thread
 * can be fresher than the snapshot, and a person's comment missing from it.
 * A snapshot cut off at the caps covers only as far back as each capped
 * list reaches, or where paging completed the list (`snapshotCoversSince`;
 * since 2026-09-30, paging since 2026-10-02); before, it never did, and
 * threads on bot-heavy PRs could never clear.
 */
function prCoversThread(input: Pick<QuietReadInput, 'thread' | 'pr' | 'prFetchedAt'>, since: IsoTime | null): boolean {
  if (!snapshotCoversSince(input.pr, since)) {
    return false;
  }
  return input.prFetchedAt !== null && input.prFetchedAt >= input.thread.updatedAt;
}

/**
 * Whose turn is the user's with a move that asks something of them (reply,
 * review, re-review, address changes; merging their approved PR asks
 * nothing), and it was not at `since` (the rule's boundary: the last read,
 * or the last look), worked out on the PR as it stood then (`prAsOf`). A
 * move someone made after it (a re-review request, a changes request)
 * keeps the thread unread; one that stood before it does not (2026-09-30).
 */
export function isNewYourMove(input: Pick<QuietReadInput, 'pr' | 'events' | 'userState' | 'viewer' | 'notYours'>, since: IsoTime): boolean {
  const { pr, events, viewer, notYours } = input;
  const now = prWhoseTurn({ pr, events, userState: input.userState, viewer, notYours });
  if (now.kind !== 'you' || now.move === 'merge') {
    return false;
  }
  const before = prWhoseTurn({ pr: prAsOf(pr, since), events: eventsAsOf(events, since), userState: userStateAsOf(input.userState, since), viewer, notYours });
  return before.kind !== 'you' || before.move !== now.move;
}

/** Whether PostPile may mark this PR thread read on GitHub by itself, and if not, the first reason why not. */
export function quietReadCheck(input: QuietReadInput): QuietReadCheck {
  const { thread, pr, events, viewer } = input;
  if (!thread.unread) {
    return { kind: 'skip', why: 'not_unread' };
  }
  if (thread.lastReadAt === null) {
    return { kind: 'skip', why: 'never_read' };
  }
  if (!prCoversThread(input, thread.lastReadAt)) {
    return { kind: 'skip', why: 'stale_snapshot' };
  }
  const botEvents = botOnlySinceRead(pr, events, thread.lastReadAt, viewer);
  if (botEvents === null) {
    return { kind: 'skip', why: 'human_activity' };
  }
  if (events.some(isUnseenMergeWithoutReview)) {
    return { kind: 'skip', why: 'unseen_merge' };
  }
  if (events.some(isUnseenLoud)) {
    return { kind: 'skip', why: 'unseen_loud' };
  }
  if (isNewYourMove(input, thread.lastReadAt)) {
    return { kind: 'skip', why: 'your_move' };
  }
  return { kind: 'mark', bots: botNames(botEvents) };
}

/**
 * Why PostPile marked a thread read by itself:
 * - bots: only bot activity since the user's last read
 * - approved, changes_requested, reviewed, replied: the user acted on the PR after every unread event
 * - judged: since the user last looked only automation and people's activity the events agent judged as not needing them
 * - request_gone: a never-opened review request that no longer stands, and since it only automation and judged activity
 * - opened: the user opened the PR in PostPile while nothing was asked of them
 */
export type QuietReason = 'bots' | TouchReason | 'judged' | 'request_gone' | 'opened';

/** The "you acted after it" reasons, by the user's newest review or comment. */
export type TouchReason = 'approved' | 'changes_requested' | 'reviewed' | 'replied';

/**
 * Why a thread is left alone by the "you acted after it" reason:
 * - not_unread: GitHub has it read already
 * - stale_snapshot: the stored PR snapshot is older than the thread's last update, or cut off at the query's caps
 * - no_touch: the user never reviewed or commented on the PR (a push, merge or close does not count here)
 * - nothing_known: no event by someone else since the last read, so the thread is unread for a reason the app cannot see
 * - acted_without_seeing: a person's event before the touch that no read of the user's covers (`sawBeforeActing`):
 *   acting alone does not say they saw it (2026-09-30)
 * - activity_after: a person did something after the user's touch
 * - unseen_merge: a merge without the user's review came after their touch
 * - unseen_loud: the PR has unseen loud news
 */
export type TouchedSkip = 'not_unread' | 'stale_snapshot' | 'no_touch' | 'nothing_known' | 'acted_without_seeing' | 'activity_after' | 'unseen_merge' | 'unseen_loud';

export type TouchedReadCheck = { kind: 'mark'; reason: TouchReason } | { kind: 'skip'; why: TouchedSkip };

export type TouchedReadInput = Pick<QuietReadInput, 'thread' | 'pr' | 'events' | 'userState' | 'viewer' | 'prFetchedAt'>;

/** The reason a reading touch gives; READING_TOUCH_KINDS only, so anything else is a comment. */
function touchReason(kind: TouchKind): TouchReason {
  switch (kind) {
    case 'approval':
      return 'approved';
    case 'changes_request':
      return 'changes_requested';
    case 'review':
      return 'reviewed';
    default:
      return 'replied';
  }
}

/**
 * Whether PostPile may mark this PR thread read on GitHub because the user
 * reviewed or commented after every unread event (DESIGN.md "You already
 * dealt with it"). Unread means after `last_read_at`, or everything when the
 * thread was never read. Bots after the touch are fine as in the bot-only
 * rule (a bot's review on their own open PR included, 2026-10-01). Whose turn is not checked: the
 * mark-read changes nothing PostPile shows (the events before the touch are
 * seen already), so a move that is still theirs stays on the tile.
 */
export function touchedReadCheck(input: TouchedReadInput): TouchedReadCheck {
  const { thread, pr, events, viewer } = input;
  if (!thread.unread) {
    return { kind: 'skip', why: 'not_unread' };
  }
  const touch = lastTouch(pr, events, viewer, { kinds: READING_TOUCH_KINDS });
  if (!prCoversThread(input, touch?.at ?? null)) {
    return { kind: 'skip', why: 'stale_snapshot' };
  }
  if (touch === null) {
    return { kind: 'skip', why: 'no_touch' };
  }
  const lastReadAt = thread.lastReadAt;
  const unread = events.filter((event) => !isOwnEvent(event, viewer) && (lastReadAt === null || event.at > lastReadAt));
  if (unread.length === 0) {
    return { kind: 'skip', why: 'nothing_known' };
  }
  const reads = { lastReadAt, handledAt: input.userState?.handledAt ?? null };
  if (!sawEverythingBefore(events, touch.at, reads, pr, viewer)) {
    return { kind: 'skip', why: 'acted_without_seeing' };
  }
  const late = unread.filter((event) => event.at > touch.at);
  if (!late.every((event) => isAutomationOn(event, pr, viewer))) {
    return { kind: 'skip', why: 'activity_after' };
  }
  if (events.some((event) => isUnseenMergeWithoutReview(event) && event.at > touch.at)) {
    return { kind: 'skip', why: 'unseen_merge' };
  }
  if (events.some(isUnseenLoud)) {
    return { kind: 'skip', why: 'unseen_loud' };
  }
  return { kind: 'mark', reason: touchReason(touch.kind) };
}

/** A review request event that names the viewer or one of their teams, whoever clicked it. */
function isRequestOfViewer(event: PrEvent, pr: Pr, viewer: Viewer): boolean {
  return event.kind === 'review_requested' && isViewerSubject(reviewRequestTarget(event, pr), viewer);
}

/**
 * An ask of the viewer, never cleared by PostPile itself: a mention, team
 * mention, question or reply to them, a person's comment edit that now
 * mentions them or a home team (`editMentionOf`), a review request of them
 * or their team (whoever clicked it), a merge without their review they
 * have not seen. The agent lowering it does not change that: only the
 * viewer deals with an ask. A mention of only routing teams is FYI
 * (DESIGN.md "Team roles"), so it is not one: the agent judges it like
 * other quiet news.
 */
export function isAskOfViewer(event: PrEvent, pr: Pr, viewer: Viewer): boolean {
  if (ADDRESSED_KINDS.includes(event.kind)) {
    return !isRoutingTeamMention(event, pr, viewer);
  }
  if (event.kind === 'comment_edited') {
    return editMentionOf(event, pr, viewer) !== null;
  }
  if (event.kind === 'review_requested') {
    return isRequestOfViewer(event, pr, viewer);
  }
  return isUnseenMergeWithoutReview(event);
}

/**
 * A person's activity the events agent (or the user) looked at and left
 * below loud: it needs nothing from the viewer. Without an override nobody
 * judged it yet.
 */
export function isJudgedQuiet(event: PrEvent): boolean {
  return event.override !== null && event.override.loudness !== 'loud';
}

/**
 * A person's activity that needs nothing from the viewer: the events agent
 * (or the user) looked at it and left it below loud, or it is bot talk
 * (`PrEvent.chatter`), which needs nobody's judgement: a "fixed" to a review
 * bot, "@codex review", GitHub's empty reply review (2026-10-06).
 */
function needsNothing(event: PrEvent): boolean {
  return isJudgedQuiet(event) || (event.chatter && event.override === null);
}

/**
 * A person's quiet event the judged rule waits on: someone else's, not
 * automation, not an ask, not bot talk (`PrEvent.chatter`), still at its
 * rule's loudness (no override) and unseen. On an unread thread the events
 * agent gets it (DESIGN.md "GitHub unread is PostPile unread"): left quiet
 * it becomes clearable, raised to loud it pings and keeps the thread unread.
 */
export function awaitsJudgement(event: PrEvent, pr: Pr, viewer: Viewer): boolean {
  if (event.override !== null || event.seenAt !== null || event.ruleLoudness !== 'quiet' || event.chatter) {
    return false;
  }
  return !isOwnEvent(event, viewer) && !isAutomationOn(event, pr, viewer) && !isAskOfViewer(event, pr, viewer);
}

/**
 * Where "since you last looked" starts for the judged rule: the newer of
 * GitHub's read time and the viewer's last review or comment. Null when they
 * never read the thread and never reviewed or commented.
 */
export function lastLookedAt(thread: NotificationThread, pr: Pr, events: PrEvent[], viewer: Viewer): IsoTime | null {
  const touch = lastTouch(pr, events, viewer, { kinds: READING_TOUCH_KINDS });
  const times = [thread.lastReadAt, touch?.at ?? null].filter((time): time is IsoTime => time !== null);
  return times.sort().at(-1) ?? null;
}

/**
 * Why a thread is left alone by the judged rule:
 * - not_unread: GitHub has it read already
 * - stale_snapshot: the stored PR snapshot is older than the thread's last update, or cut off at the query's caps
 * - never_looked: the user never read the thread and never reviewed or commented on the PR
 * - nothing_known: nothing by someone else since the user last looked
 * - asks_you: an ask of the user came since (`isAskOfViewer`)
 * - unseen_loud: loud news since, or unseen loud news on the PR
 * - no_people: only automation since: the bot-only and acted-after rules decide
 * - not_judged: a person's activity since that the events agent has not judged yet (bot talk needs no judgement)
 * - unseen_merge: a merge without the user's review they have not seen
 * - your_move: whose turn is the user's, and it was not when they last looked (`isNewYourMove`)
 */
export type JudgedSkip =
  | 'not_unread'
  | 'stale_snapshot'
  | 'never_looked'
  | 'nothing_known'
  | 'asks_you'
  | 'unseen_loud'
  | 'no_people'
  | 'not_judged'
  | 'unseen_merge'
  | 'your_move';

/** `actors`: everyone since the user last looked, in order of first appearance, "GitHub" for actor-less events. */
export type JudgedReadCheck = { kind: 'mark'; actors: string[] } | { kind: 'skip'; why: JudgedSkip };

/**
 * Whether PostPile may mark this PR thread read on GitHub because everything
 * since the user last looked (`lastLookedAt`) is automation, bot talk
 * (`PrEvent.chatter`) or a person's activity the events agent judged as not
 * needing them (`needsNothing`), with no ask among it
 * (DESIGN.md "GitHub unread is PostPile unread", 2026-09-30). The same
 * safety checks as the bot-only rule: fresh complete snapshot, no unseen
 * merge, no new move of theirs. Agent
 * NOT_YOURS, age, merged or closed, an old handled mark or approval are not
 * evidence here.
 */
export function judgedReadCheck(input: QuietReadInput): JudgedReadCheck {
  const { thread, pr, events, viewer } = input;
  if (!thread.unread) {
    return { kind: 'skip', why: 'not_unread' };
  }
  const since = lastLookedAt(thread, pr, events, viewer);
  if (!prCoversThread(input, since)) {
    return { kind: 'skip', why: 'stale_snapshot' };
  }
  if (since === null) {
    return { kind: 'skip', why: 'never_looked' };
  }
  const after = events.filter((event) => !isOwnEvent(event, viewer) && event.at > since);
  if (after.length === 0) {
    return { kind: 'skip', why: 'nothing_known' };
  }
  if (after.some((event) => isAskOfViewer(event, pr, viewer))) {
    return { kind: 'skip', why: 'asks_you' };
  }
  if (events.some(isUnseenLoud) || after.some((event) => effectiveLoudness(event) === 'loud')) {
    return { kind: 'skip', why: 'unseen_loud' };
  }
  const people = after.filter((event) => !isAutomationOn(event, pr, viewer));
  if (people.length === 0) {
    return { kind: 'skip', why: 'no_people' };
  }
  if (!people.every(needsNothing)) {
    return { kind: 'skip', why: 'not_judged' };
  }
  if (events.some(isUnseenMergeWithoutReview)) {
    return { kind: 'skip', why: 'unseen_merge' };
  }
  if (isNewYourMove(input, since)) {
    return { kind: 'skip', why: 'your_move' };
  }
  return { kind: 'mark', actors: botNames(after) };
}

/**
 * Why a thread is left alone by the "review request no longer stands" rule:
 * - not_unread: GitHub has it read already
 * - was_read: the thread has a read time on GitHub: the other rules decide
 * - not_requested: GitHub's reason is not a review request (a mention, an assignment, ...)
 * - stale_snapshot: the stored PR snapshot is older than the thread's last update, or cut off at the query's caps
 * - no_request: no review request of the user or their teams among the events
 * - request_stands: a request of the user or one of their teams is still pending and nobody took it
 * - nothing_known: nothing by someone else since the request
 * - asks_you: an ask of the user came since the request, or one is unseen (`isAskOfViewer`)
 * - unseen_loud: loud news since the request, or unseen loud news on the PR besides the request itself
 * - not_judged: a person's activity since the request that the events agent has not judged quiet
 * - unseen_merge: a merge without the user's review they have not seen
 * - your_move: whose turn is the user's, and it was not at the request (`isNewYourMove`)
 */
export type RequestGoneSkip =
  | 'not_unread'
  | 'was_read'
  | 'not_requested'
  | 'stale_snapshot'
  | 'no_request'
  | 'request_stands'
  | 'nothing_known'
  | 'asks_you'
  | 'unseen_loud'
  | 'not_judged'
  | 'unseen_merge'
  | 'your_move';

/** `actors`: everyone since the request, in order of first appearance, "GitHub" for actor-less events. */
export type RequestGoneReadCheck = { kind: 'mark'; actors: string[] } | { kind: 'skip'; why: RequestGoneSkip };

/** When the newest review request of the viewer or one of their teams was made; null when there is none. */
function latestRequestOfViewer(pr: Pr, events: PrEvent[], viewer: Viewer): IsoTime | null {
  const times = events.filter((event) => isRequestOfViewer(event, pr, viewer)).map((event) => event.at);
  return times.toSorted().at(-1) ?? null;
}

/**
 * Whether PostPile may mark a never-opened review request thread read on
 * GitHub because the request no longer stands: nothing pending for the user
 * or any of their teams (removed, or answered by them or a teammate:
 * `reviewRequest` is null or team_taken), and everything by someone else
 * since the newest request of them or their team is automation or a
 * person's activity the events agent judged as not needing them, the same
 * standard as `judgedReadCheck` (DESIGN.md "Handled quietly" › Review
 * requests that no longer stand, 2026-10-02). The requests themselves are
 * what the rule reads, so their unseen loudness does not block it; any
 * other unseen loud news does. Other never-read threads stay with the user.
 */
export function requestGoneReadCheck(input: QuietReadInput): RequestGoneReadCheck {
  const { thread, pr, events, viewer } = input;
  if (!thread.unread) {
    return { kind: 'skip', why: 'not_unread' };
  }
  if (thread.lastReadAt !== null) {
    return { kind: 'skip', why: 'was_read' };
  }
  if (thread.reason !== 'review_requested') {
    return { kind: 'skip', why: 'not_requested' };
  }
  const requestAt = latestRequestOfViewer(pr, events, viewer);
  if (!prCoversThread(input, requestAt)) {
    return { kind: 'skip', why: 'stale_snapshot' };
  }
  if (requestAt === null) {
    return { kind: 'skip', why: 'no_request' };
  }
  const request = reviewRequest(pr, viewer);
  // A team asked again after a teammate's review stands: only a review after the newest request took it.
  const taken = request === 'team_taken' && teamRequestTakenBy(pr, viewer, requestAt).length > 0;
  if (request !== null && !taken) {
    return { kind: 'skip', why: 'request_stands' };
  }
  const others = events.filter((event) => !isOwnEvent(event, viewer));
  const after = others.filter((event) => event.at > requestAt);
  if (after.length === 0) {
    return { kind: 'skip', why: 'nothing_known' };
  }
  const isRequest = (event: PrEvent) => isRequestOfViewer(event, pr, viewer);
  if (others.some((event) => !isRequest(event) && (event.at > requestAt || event.seenAt === null) && isAskOfViewer(event, pr, viewer))) {
    return { kind: 'skip', why: 'asks_you' };
  }
  const unseenLoud = events.some((event) => isUnseenLoud(event) && !isRequest(event));
  if (unseenLoud || after.some((event) => effectiveLoudness(event) === 'loud')) {
    return { kind: 'skip', why: 'unseen_loud' };
  }
  const people = after.filter((event) => !isAutomationOn(event, pr, viewer));
  if (!people.every(needsNothing)) {
    return { kind: 'skip', why: 'not_judged' };
  }
  if (events.some(isUnseenMergeWithoutReview)) {
    return { kind: 'skip', why: 'unseen_merge' };
  }
  if (isNewYourMove(input, requestAt)) {
    return { kind: 'skip', why: 'your_move' };
  }
  return { kind: 'mark', actors: botNames(after) };
}

/**
 * The quiet reads would mark this PR thread read: only bots since the last
 * read, the user acted after it, everything since they last looked judged
 * quiet, or a never-opened review request that no longer stands. A retired
 * topic comes back only for a thread that is not (`reviveUnreadTopics`):
 * bot-only noise the quiet reads clear brings nothing back.
 */
export function clearableByRule(input: QuietReadInput): boolean {
  return (
    quietReadCheck(input).kind === 'mark' ||
    touchedReadCheck(input).kind === 'mark' ||
    judgedReadCheck(input).kind === 'mark' ||
    requestGoneReadCheck(input).kind === 'mark'
  );
}

/**
 * A user's Mark read that GitHub skipped for activity after the last sync,
 * decided again once the PR was fetched (DESIGN.md "GitHub writes: lock,
 * action log" › Newer activity after a click):
 * - mark: after what PostPile showed at the click there is only the
 *   viewer's own activity and automation (`bots` names the automation, empty
 *   for none), so GitHub may mark it read now
 * - keep, stale_snapshot: the fetched snapshot still does not cover the
 *   thread, so a person's comment may be missing
 * - keep, people: someone else, not automation, did something after the
 *   click; `news` holds those events, newest first
 */
export type ClickedReadCheck =
  | { kind: 'mark'; bots: string[] }
  | { kind: 'keep'; why: 'stale_snapshot' }
  | { kind: 'keep'; why: 'people'; news: PrEvent[] };

export interface ClickedReadInput extends Pick<QuietReadInput, 'pr' | 'events' | 'viewer' | 'prFetchedAt'> {
  /** The thread as GitHub has it now, after the skip. */
  thread: NotificationThread;
  /** The thread's updated_at the click saw: everything up to it was on screen. */
  shownUpTo: IsoTime;
}

/**
 * The bot-only rule from the click on, for an explicit Mark read. The click
 * means "I saw what PostPile showed me and I'm done", so unlike the quiet
 * reads automation on the viewer's own open PR does not block, and nothing
 * known after the click (only the viewer's own pushes, say) is no reason to
 * keep it. The one thing that must not vanish unseen is a person's activity
 * after the click.
 */
export function clickedReadCheck(input: ClickedReadInput): ClickedReadCheck {
  const { pr, events, viewer, shownUpTo } = input;
  if (!prCoversThread(input, shownUpTo)) {
    return { kind: 'keep', why: 'stale_snapshot' };
  }
  const others = events.filter((event) => event.at > shownUpTo && !isOwnEvent(event, viewer));
  if (others.length === 0) {
    return { kind: 'mark', bots: [] };
  }
  const bots = botOnlySinceRead(pr, events, shownUpTo, viewer);
  if (bots !== null) {
    return { kind: 'mark', bots: botNames(bots) };
  }
  const news = others.filter((event) => !isAutomationOn(event, pr, viewer)).toSorted((a, b) => b.at.localeCompare(a.at));
  return { kind: 'keep', why: 'people', news };
}

/** An event kind in the words of "a review from alice". */
function newsNoun(kind: EventKind): string {
  if (PUSH_KINDS.includes(kind)) {
    return 'push';
  }
  switch (kind) {
    case 'mention':
    case 'team_mention':
      return 'mention';
    case 'question_to_user':
      return 'question';
    case 'reply_to_user':
      return 'reply';
    case 'comment':
    case 'bot_comment':
      return 'comment';
    case 'comment_edited':
      return 'comment edit';
    case 'review_approved':
    case 'review_changes_requested':
    case 'review_commented':
      return 'review';
    case 'review_requested':
      return 'review request';
    case 'merged':
    case 'merged_without_review':
      return 'merge';
    default:
      return 'change';
  }
}

/** The newest news in words, "review from alice", plus " and 2 more". */
function newsWords(news: PrEvent[]): string {
  const newest = news[0];
  if (newest === undefined) {
    return 'activity';
  }
  const more = news.length > 1 ? ` and ${news.length - 1} more` : '';
  return `${newsNoun(newest.kind)} from ${newest.actor === '' ? NO_ACTOR_NAME : newest.actor}${more}`;
}

/** Why a clicked mark-read stays unread, for the sync report and the pending-send result: "new review from alice". */
export function clickedReadReason(check: Extract<ClickedReadCheck, { kind: 'keep' }>): string {
  return check.why === 'people' ? `new ${newsWords(check.news)}` : 'activity after the last sync';
}

/** Action log detail of a clicked mark-read after the refresh: "marked after refresh: only your own activity", "kept unread: new review from alice". */
export function clickedReadDetail(check: ClickedReadCheck): string {
  if (check.kind === 'keep') {
    return `kept unread: ${clickedReadReason(check)}`;
  }
  return check.bots.length === 0
    ? 'marked after refresh: only your own activity'
    : `marked after refresh: only your own activity and automation (${check.bots.join(', ')})`;
}

/** The toast when a clicked mark-read stays unread: "New since you looked: a review from alice". */
export function clickedReadNotice(check: ClickedReadCheck): string {
  if (check.kind === 'keep' && check.why === 'people') {
    return `New since you looked: a ${newsWords(check.news)}`;
  }
  return 'New activity on GitHub since you looked: still unread';
}

/** One tile that holds the opened PR, as far as the "opened in PostPile" rule cares. */
export interface OpenedTile {
  snoozed: boolean;
}

/**
 * Why opening a PR in PostPile leaves it alone:
 * - no_thread: the PR has no notification thread (a found PR): nothing on GitHub to mirror
 * - no_tile: no tile shows the PR
 * - snoozed: the user put a tile holding it away for later
 * - asks_you: a mark-read of the PR would leave something asked of the user
 * - stale_snapshot: the thread is unread and the stored PR snapshot is older than it, or PostPile's own caps cut activity from the unread interval, so the detail pane the user looked at missed the newest activity (`openedSnapshotCovers`)
 */
export type OpenedSkip = 'no_thread' | 'no_tile' | 'snoozed' | 'asks_you' | 'stale_snapshot';

/**
 * mark: the thread is unread on GitHub; mark it read there, then handle the
 * PR here. handle: GitHub has the thread read already (a github.com visit,
 * an earlier open), so only PostPile's side is left: handle the PR here.
 */
export type OpenedReadCheck = { kind: 'mark' } | { kind: 'handle' } | { kind: 'skip'; why: OpenedSkip };

export interface OpenedReadInput {
  /** The PR's notification thread, null when it has none (a found PR). */
  thread: NotificationThread | null;
  prFetchedAt: IsoTime | null;
  /** The stored snapshot, for whether the caps cut anything (`truncated`, `capHits`); null when none is stored. */
  pr: Pr | null;
  /** Every tile that holds the PR. */
  tiles: OpenedTile[];
  /** A mark-read of this PR alone would leave it done: nothing asked of the user (`PrSummary.afterRead.done`). */
  doneAfterRead: boolean;
}

/**
 * The detail pane the user looked at showed everything up to the thread's
 * last update: the snapshot was fetched at or after it, and PostPile's caps
 * cut nothing from the unread interval since GitHub's read time
 * (`snapshotCoversSince`: no list hit our caps, or each one reaches back
 * to the read or is complete).
 */
function openedSnapshotCovers(thread: NotificationThread, prFetchedAt: IsoTime | null, pr: Pr | null): boolean {
  if (prFetchedAt === null || prFetchedAt < thread.updatedAt) {
    return false;
  }
  return pr === null || snapshotCoversSince(pr, thread.lastReadAt);
}

/**
 * Whether opening the PR in PostPile's detail pane may mark it read on
 * GitHub, like a visit on github.com does, and handle it in PostPile, limited
 * to cases where that cannot hide a to-do (DESIGN.md "You already dealt with
 * it", part 3). Checked per PR since 2026-09-29: that PR done after a
 * mark-read, no tile holding it snoozed. An unread thread also needs a
 * snapshot that showed its unread activity (`openedSnapshotCovers`).
 */
export function openedReadCheck(input: OpenedReadInput): OpenedReadCheck {
  if (input.thread === null) {
    return { kind: 'skip', why: 'no_thread' };
  }
  if (input.tiles.length === 0) {
    return { kind: 'skip', why: 'no_tile' };
  }
  if (input.tiles.some((tile) => tile.snoozed)) {
    return { kind: 'skip', why: 'snoozed' };
  }
  if (!input.doneAfterRead) {
    return { kind: 'skip', why: 'asks_you' };
  }
  if (!input.thread.unread) {
    return { kind: 'handle' };
  }
  if (!openedSnapshotCovers(input.thread, input.prFetchedAt, input.pr)) {
    return { kind: 'skip', why: 'stale_snapshot' };
  }
  return { kind: 'mark' };
}

const QUIET_DETAIL_PREFIX = 'only bot activity since your last read: ';
const JUDGED_DETAIL_PREFIX = 'nothing that needs you since you last looked: ';
const REQUEST_GONE_DETAIL_PREFIX = 'review request no longer stands, nothing that needs you since: ';

/** The quiet reasons whose log detail names who acted. */
type NamedReason = 'bots' | 'judged' | 'request_gone';

/** The detail prefixes of the reasons that name people as well as bots, and the reason each one gives. */
const PEOPLE_DETAIL_PREFIXES: [string, 'judged' | 'request_gone'][] = [
  [JUDGED_DETAIL_PREFIX, 'judged'],
  [REQUEST_GONE_DETAIL_PREFIX, 'request_gone'],
];

/** Action log details of the quiet mark-reads that name nobody; the Handled quietly view reads the reason back. */
const QUIET_REASON_DETAILS: Record<Exclude<QuietReason, NamedReason>, string> = {
  approved: 'you approved after it',
  changes_requested: 'you requested changes after it',
  reviewed: 'you reviewed after it',
  replied: 'you replied after it',
  opened: 'opened in PostPile',
};

function namesAfter(detail: string, prefix: string): string[] {
  return detail
    .slice(prefix.length)
    .split(', ')
    .filter((name) => name !== '');
}

/** Action log detail of a quiet mark-read, naming the bots. */
export function quietReadDetail(bots: string[]): string {
  return `${QUIET_DETAIL_PREFIX}${bots.join(', ')}`;
}

/** Action log detail of a judged quiet mark-read, naming everyone since the user last looked. */
export function judgedReadDetail(actors: string[]): string {
  return `${JUDGED_DETAIL_PREFIX}${actors.join(', ')}`;
}

/** Action log detail of a mark-read for a review request that no longer stands, naming everyone since the request. */
export function requestGoneReadDetail(actors: string[]): string {
  return `${REQUEST_GONE_DETAIL_PREFIX}${actors.join(', ')}`;
}

/** The bots a quiet mark-read's log detail names; empty for any other detail. */
export function botsFromQuietDetail(detail: string): string[] {
  return detail.startsWith(QUIET_DETAIL_PREFIX) ? namesAfter(detail, QUIET_DETAIL_PREFIX) : [];
}

/** Who a quiet mark-read's log detail names: the bots, everyone since the user last looked, or since the request; empty for any other detail. */
export function actorsFromQuietDetail(detail: string): string[] {
  const prefix = PEOPLE_DETAIL_PREFIXES.find(([text]) => detail.startsWith(text))?.[0];
  return prefix === undefined ? botsFromQuietDetail(detail) : namesAfter(detail, prefix);
}

/** Action log detail of a quiet mark-read for a reason that names nobody. */
export function quietReasonDetail(reason: Exclude<QuietReason, NamedReason>): string {
  return QUIET_REASON_DETAILS[reason];
}

/** The reason behind a quiet mark-read's log detail. Anything else is a bot-only one, the first and once the only reason. */
export function quietReasonFromDetail(detail: string): QuietReason {
  const named = PEOPLE_DETAIL_PREFIXES.find(([text]) => detail.startsWith(text));
  if (named !== undefined) {
    return named[1];
  }
  for (const [reason, text] of Object.entries(QUIET_REASON_DETAILS)) {
    if (detail === text) {
      return reason as QuietReason;
    }
  }
  return 'bots';
}

/** One PR thread PostPile marked read on GitHub by itself, for the "Handled quietly" view. */
export interface QuietReadView {
  /** The action log entry's id. */
  id: number;
  at: IsoTime;
  threadId: string | null;
  prKey: PrKey;
  repo: string;
  number: number;
  /** The PR's title, else the notification's, else the key. */
  title: string;
  reason: QuietReason;
  /** Who acted: the bots for the reason `bots`, everyone since the user last looked for `judged`, since the request for `request_gone`; empty otherwise. */
  bots: string[];
  /** Where the PR shows in the app now, so a click can open its tile. */
  landing: NotificationLanding;
}

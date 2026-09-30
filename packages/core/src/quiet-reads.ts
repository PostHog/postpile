// "Handled quietly": a PR thread the user had read that turned unread again
// only because of bots (CI, merge queue, review bots, deploys). PostPile marks
// it read on GitHub by itself when nothing is asked of the user. A second
// reason: the user acted on the PR after every unread event ("You already
// dealt with it"), and a third, opening the PR in PostPile, is decided by the
// engine from the tile. Rules only, no IO. DESIGN.md "Handled quietly" and
// "You already dealt with it" have the reasons behind each rule.

import { isAutomation } from './bots.ts';
import type { NotificationLanding } from './debug-views.ts';
import { isOwnEvent, lastTouch, READING_TOUCH_KINDS, type TouchKind } from './last-touch.ts';
import { isUnseenMergeWithoutReview } from './loudness.ts';
import { isPrOwner } from './pr-owners.ts';
import { reviewRequestTarget } from './review-request.ts';
import type { IsoTime, NotificationThread, Pr, PrEvent, PrKey, UserPrState, Viewer } from './types.ts';
import { prWhoseTurn } from './whose-turn.ts';

/** How long after the newest bot activity PostPile waits, so a person who answers the bot right away still counts. */
export const QUIET_GRACE_MS = 10 * 60_000;

/** How far back the "Handled quietly" view looks. */
export const HANDLED_QUIETLY_DAYS = 7;

/** Threads one run marks read at most; the rest wait for the next run. */
export const QUIET_READS_PER_RUN = 50;

/** Name shown for bot activity without an actor (a CI result). */
export const CI_ACTOR = 'CI';

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

/** The bots behind the events, in order of first appearance, "CI" for actor-less ones. */
export function botNames(events: PrEvent[]): string[] {
  return [...new Set(events.map((event) => (event.actor === '' ? CI_ACTOR : event.actor)))];
}

/**
 * Why a thread is left alone:
 * - not_unread: GitHub has it read already
 * - never_read: the user never read it (no last_read_at), so it is not "back" because of bots
 * - stale_snapshot: the stored PR snapshot is older than the thread's last update (a PR the
 *   sync left out at its cap, or whose fetch failed), or it was cut off at the query's caps
 *   (`Pr.truncated`), so a person's comment may be missing
 * - human_activity: someone else did something since the last read, or nothing known happened
 * - own_pr: bot reviews and CI on the user's own open PR can mean work for them (merged or closed: they can't)
 * - unseen_merge: a merge without the user's review is never marked read by PostPile
 * - tile_unread: the tile shows something new for the user
 * - your_move: whose turn is the user's
 * - grace: the newest activity is less than QUIET_GRACE_MS old
 */
export type QuietSkip = 'not_unread' | 'never_read' | 'stale_snapshot' | 'human_activity' | 'own_pr' | 'unseen_merge' | 'tile_unread' | 'your_move' | 'grace';

export type QuietReadCheck = { kind: 'mark'; bots: string[] } | { kind: 'skip'; why: QuietSkip };

export interface QuietReadInput {
  thread: NotificationThread;
  pr: Pr;
  events: PrEvent[];
  userState: UserPrState | null;
  viewer: Viewer;
  /** The tile holding the PR is unread (an unseen loud event on any of its PRs). */
  tileUnread: boolean;
  /** The PR's glance says NOT_YOURS; whose turn reads it the same way the tile does. */
  notYours: boolean;
  /** When the stored PR snapshot was fetched; null when unknown. */
  prFetchedAt: IsoTime | null;
  now: IsoTime;
}

export interface SnapshotCoverInput {
  thread: NotificationThread;
  prFetchedAt: IsoTime | null;
  /** The snapshot was cut off at the query's caps (`Pr.truncated`). */
  prTruncated: boolean;
}

/**
 * The stored events can only vouch for "bots only" when the snapshot was
 * fetched at or after the thread's last update. A sync refreshes every
 * thread but may leave a PR out (its cap, a failed fetch): then the thread
 * can be fresher than the snapshot, and a person's comment missing from it.
 * A snapshot cut off at the query's caps (any capped activity list: reviews,
 * comments, review threads and their comments, commits, timeline) never
 * covers the thread: an event past the caps never arrived, however fresh
 * the fetch.
 */
export function snapshotCoversThread(input: SnapshotCoverInput): boolean {
  if (input.prTruncated) {
    return false;
  }
  return input.prFetchedAt !== null && input.prFetchedAt >= input.thread.updatedAt;
}

/** The snapshot check for an input that carries the PR itself. */
function prCoversThread(input: Pick<QuietReadInput, 'thread' | 'pr' | 'prFetchedAt'>): boolean {
  return snapshotCoversThread({ thread: input.thread, prFetchedAt: input.prFetchedAt, prTruncated: input.pr.truncated === true });
}

/**
 * The user's own PR while it is open. Bots there (a failing check, a review
 * bot's finding) can mean work, so their activity keeps the thread unread.
 * Once merged or closed they can't: every own PR merges through a queue bot
 * after the last comment (2026-09-29).
 */
function isOwnOpenPr(pr: Pr, viewer: Viewer): boolean {
  return pr.state === 'OPEN' && isPrOwner(pr, viewer.login);
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
  if (!prCoversThread(input)) {
    return { kind: 'skip', why: 'stale_snapshot' };
  }
  const botEvents = botOnlySinceRead(pr, events, thread.lastReadAt, viewer);
  if (botEvents === null) {
    return { kind: 'skip', why: 'human_activity' };
  }
  if (isOwnOpenPr(pr, viewer)) {
    return { kind: 'skip', why: 'own_pr' };
  }
  if (events.some(isUnseenMergeWithoutReview)) {
    return { kind: 'skip', why: 'unseen_merge' };
  }
  if (input.tileUnread) {
    return { kind: 'skip', why: 'tile_unread' };
  }
  if (prWhoseTurn({ pr, events, userState: input.userState, viewer, notYours: input.notYours }).kind === 'you') {
    return { kind: 'skip', why: 'your_move' };
  }
  // Counted from the thread's own update too: a bot push can carry an older commit date.
  const newest = [thread.updatedAt, ...botEvents.map((event) => event.at)].sort().at(-1) ?? thread.updatedAt;
  if (new Date(input.now).getTime() - new Date(newest).getTime() < QUIET_GRACE_MS) {
    return { kind: 'skip', why: 'grace' };
  }
  return { kind: 'mark', bots: botNames(botEvents) };
}

/**
 * Why PostPile marked a thread read by itself:
 * - bots: only bot activity since the user's last read
 * - approved, changes_requested, reviewed, replied: the user acted on the PR after every unread event
 * - opened: the user opened the PR in PostPile while nothing was asked of them
 */
export type QuietReason = 'bots' | TouchReason | 'opened';

/** The "you acted after it" reasons, by the user's newest review or comment. */
export type TouchReason = 'approved' | 'changes_requested' | 'reviewed' | 'replied';

/**
 * Why a thread is left alone by the "you acted after it" reason:
 * - not_unread: GitHub has it read already
 * - stale_snapshot: the stored PR snapshot is older than the thread's last update, or cut off at the query's caps
 * - no_touch: the user never reviewed or commented on the PR (a push, merge or close does not count here)
 * - nothing_known: no event by someone else since the last read, so the thread is unread for a reason the app cannot see
 * - activity_after: a person did something after the user's touch
 * - own_pr: bots acted after the touch on the user's own open PR, which can mean work
 * - unseen_merge: a merge without the user's review came after their touch
 * - tile_unread: the tile shows something new for the user
 * - grace: the touch or the newest activity is less than QUIET_GRACE_MS old
 */
export type TouchedSkip = 'not_unread' | 'stale_snapshot' | 'no_touch' | 'nothing_known' | 'activity_after' | 'own_pr' | 'unseen_merge' | 'tile_unread' | 'grace';

export type TouchedReadCheck = { kind: 'mark'; reason: TouchReason } | { kind: 'skip'; why: TouchedSkip };

export type TouchedReadInput = Pick<QuietReadInput, 'thread' | 'pr' | 'events' | 'viewer' | 'tileUnread' | 'prFetchedAt' | 'now'>;

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
 * rule, except on the user's own open PR. Whose turn is not checked: the
 * mark-read changes nothing PostPile shows (the events before the touch are
 * seen already), so a move that is still theirs stays on the tile.
 */
export function touchedReadCheck(input: TouchedReadInput): TouchedReadCheck {
  const { thread, pr, events, viewer } = input;
  if (!thread.unread) {
    return { kind: 'skip', why: 'not_unread' };
  }
  if (!prCoversThread(input)) {
    return { kind: 'skip', why: 'stale_snapshot' };
  }
  const touch = lastTouch(pr, events, viewer, { kinds: READING_TOUCH_KINDS });
  if (touch === null) {
    return { kind: 'skip', why: 'no_touch' };
  }
  const lastReadAt = thread.lastReadAt;
  const unread = events.filter((event) => !isOwnEvent(event, viewer) && (lastReadAt === null || event.at > lastReadAt));
  if (unread.length === 0) {
    return { kind: 'skip', why: 'nothing_known' };
  }
  const late = unread.filter((event) => event.at > touch.at);
  if (!late.every((event) => isAutomationOn(event, pr, viewer))) {
    return { kind: 'skip', why: 'activity_after' };
  }
  if (late.length > 0 && isOwnOpenPr(pr, viewer)) {
    return { kind: 'skip', why: 'own_pr' };
  }
  if (events.some((event) => isUnseenMergeWithoutReview(event) && event.at > touch.at)) {
    return { kind: 'skip', why: 'unseen_merge' };
  }
  if (input.tileUnread) {
    return { kind: 'skip', why: 'tile_unread' };
  }
  const newest = [thread.updatedAt, touch.at, ...late.map((event) => event.at)].sort().at(-1) ?? thread.updatedAt;
  if (new Date(input.now).getTime() - new Date(newest).getTime() < QUIET_GRACE_MS) {
    return { kind: 'skip', why: 'grace' };
  }
  return { kind: 'mark', reason: touchReason(touch.kind) };
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
 * - stale_snapshot: the thread is unread and the stored PR snapshot is older than it, or cut off at the query's caps, so the user did not see the newest activity
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
  /** The stored snapshot was cut off at the query's caps (`Pr.truncated`). */
  prTruncated: boolean;
  /** Every tile that holds the PR. */
  tiles: OpenedTile[];
  /** A mark-read of this PR alone would leave it done: nothing asked of the user (`PrSummary.afterRead.done`). */
  doneAfterRead: boolean;
}

/**
 * Whether opening the PR in PostPile's detail pane may mark it read on
 * GitHub, like a visit on github.com does, and handle it in PostPile, limited
 * to cases where that cannot hide a to-do (DESIGN.md "You already dealt with
 * it", part 3). Checked per PR since 2026-09-29: that PR done after a
 * mark-read, no tile holding it snoozed.
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
  if (!snapshotCoversThread({ thread: input.thread, prFetchedAt: input.prFetchedAt, prTruncated: input.prTruncated })) {
    return { kind: 'skip', why: 'stale_snapshot' };
  }
  return { kind: 'mark' };
}

const QUIET_DETAIL_PREFIX = 'only bot activity since your last read: ';

/** Action log details of the quiet mark-reads that are not about bots; the Handled quietly view reads the reason back. */
const QUIET_REASON_DETAILS: Record<Exclude<QuietReason, 'bots'>, string> = {
  approved: 'you approved after it',
  changes_requested: 'you requested changes after it',
  reviewed: 'you reviewed after it',
  replied: 'you replied after it',
  opened: 'opened in PostPile',
};

/** Action log detail of a quiet mark-read, naming the bots. */
export function quietReadDetail(bots: string[]): string {
  return `${QUIET_DETAIL_PREFIX}${bots.join(', ')}`;
}

/** The bots a quiet mark-read's log detail names; empty for any other detail. */
export function botsFromQuietDetail(detail: string): string[] {
  if (!detail.startsWith(QUIET_DETAIL_PREFIX)) {
    return [];
  }
  return detail
    .slice(QUIET_DETAIL_PREFIX.length)
    .split(', ')
    .filter((name) => name !== '');
}

/** Action log detail of a quiet mark-read for any reason but bots. */
export function quietReasonDetail(reason: Exclude<QuietReason, 'bots'>): string {
  return QUIET_REASON_DETAILS[reason];
}

/** The reason behind a quiet mark-read's log detail. Anything else is a bot-only one, the first and once the only reason. */
export function quietReasonFromDetail(detail: string): QuietReason {
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
  /** The bots, for the reason `bots`; empty otherwise. */
  bots: string[];
  /** Where the PR shows in the app now, so a click can open its tile. */
  landing: NotificationLanding;
}

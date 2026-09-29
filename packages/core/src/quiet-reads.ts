// "Handled quietly": a PR thread the user had read that turned unread again
// only because of bots (CI, merge queue, review bots, deploys). PostPile marks
// it read on GitHub by itself when nothing is asked of the user. Rules only,
// no IO. DESIGN.md "Handled quietly" has the reasons behind each rule.

import type { NotificationLanding } from './debug-views.ts';
import { isUnseenMergeWithoutReview } from './loudness.ts';
import { sameLogin } from './mentions.ts';
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
 * Automation: a bot account (`isBot` when the event was built), or no actor
 * at all. CI results carry an empty actor and are flagged as bots already;
 * the empty check keeps any other actor-less event on the safe side.
 */
export function isBotEvent(event: PrEvent): boolean {
  return event.isBot || event.actor === '';
}

/**
 * The events after the thread's last read, when every one of them is
 * automation. Null when a person took part, or when nothing after the read
 * is known (the thread turned unread for a reason the app cannot see).
 */
export function botOnlySinceRead(events: PrEvent[], lastReadAt: IsoTime): PrEvent[] | null {
  const since = events.filter((event) => event.at > lastReadAt);
  if (since.length === 0 || !since.every(isBotEvent)) {
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
 * - human_activity: a person did something since the last read, or nothing known happened
 * - own_pr: bot reviews and CI on the user's own PR can mean work for them
 * - unseen_merge: a merge without the user's review is never marked read by PostPile
 * - tile_unread: the tile shows something new for the user
 * - your_move: whose turn is the user's
 * - grace: the newest activity is less than QUIET_GRACE_MS old
 */
export type QuietSkip = 'not_unread' | 'never_read' | 'human_activity' | 'own_pr' | 'unseen_merge' | 'tile_unread' | 'your_move' | 'grace';

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
  now: IsoTime;
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
  const botEvents = botOnlySinceRead(events, thread.lastReadAt);
  if (botEvents === null) {
    return { kind: 'skip', why: 'human_activity' };
  }
  if (sameLogin(pr.author, viewer.login)) {
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

const QUIET_DETAIL_PREFIX = 'only bot activity since your last read: ';

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
  bots: string[];
  /** Where the PR shows in the app now, so a click can open its tile. */
  landing: NotificationLanding;
}

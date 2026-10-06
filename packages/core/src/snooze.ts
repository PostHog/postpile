import { botThreadOf } from './bot-threads.ts';
import { isAutomation } from './bots.ts';
import { PUSH_KINDS } from './kinds.ts';
import { effectiveLoudness, raisedToLoud } from './loudness.ts';
import { sameLogin } from './mentions.ts';
import { isPersonalAsk } from './pings.ts';
import { isTracked } from './provenance.ts';
import { reviewRequestTarget } from './review-request.ts';
import type { EventKind, IsoTime, Pr, PrEvent, PrKey, Snooze, SnoozeCondition, Tile, Viewer } from './types.ts';

export interface SnoozeContext {
  /** The snoozed PR. */
  pr: Pr;
  /** Its events. */
  events: PrEvent[];
  now: IsoTime;
  /** The viewer's own replies never end a "someone replies" snooze. */
  viewer?: Viewer | null;
}

// Wider than the asks in kinds.ts on purpose: any human comment or review
// ends a "someone replies" snooze, not only one aimed at the viewer. A reply
// to a bot in a review thread does not (`botThreadOf`): it answers the bot.
const replyKinds: EventKind[] = [
  'mention',
  'team_mention',
  'reply_to_user',
  'question_to_user',
  'comment',
  'review_approved',
  'review_changes_requested',
  'review_commented',
];

function isByViewer(event: PrEvent, viewer: Viewer | null): boolean {
  return viewer !== null && sameLogin(event.actor, viewer.login);
}

/** `isAutomation` for an event of the snoozed PR, its request target looked up on the PR. */
function isAutomationOn(event: PrEvent, context: SnoozeContext): boolean {
  return isAutomation(event, reviewRequestTarget(event, context.pr), context.viewer ?? null);
}

function someoneReplied(snooze: Snooze, context: SnoozeContext): boolean {
  return context.events.some(
    (event) =>
      event.at > snooze.since &&
      replyKinds.includes(event.kind) &&
      botThreadOf(event, context.pr) === null &&
      !isAutomationOn(event, context) &&
      !isByViewer(event, context.viewer ?? null),
  );
}

function newPush(snooze: Snooze, context: SnoozeContext): boolean {
  return context.events.some((event) => event.at > snooze.since && PUSH_KINDS.includes(event.kind));
}

/**
 * What ends a mute (2026-10-05): someone asked the viewer in person since
 * (`isPersonalAsk`: a mention, question or reply to them, a comment edited
 * to mention them, a review request that names them). Never automation: a
 * bot's mention does not count, a review request that names the viewer does
 * (`isAutomation` calls it no bot's, whoever clicked it). The viewer's own
 * events never do. Without a viewer nothing is aimed at anyone yet.
 */
function personallyAsked(snooze: Snooze, context: SnoozeContext): boolean {
  const viewer = context.viewer ?? null;
  if (viewer === null) {
    return false;
  }
  return context.events.some(
    (event) => event.at > snooze.since && isPersonalAsk(event, context.pr, viewer) && !isAutomationOn(event, context) && !isByViewer(event, viewer),
  );
}

/**
 * True once the snooze condition is met: a human reply, a push, the time
 * passed, or for a mute a personal ask. Every snooze also ends when the PR
 * is merged or closed (decided 2026-09-30): nothing left to wait for, and a
 * snooze that holds a finished PR keeps its topic from retiring.
 */
export function isSnoozeOver(snooze: Snooze, context: SnoozeContext): boolean {
  if (context.pr.state !== 'OPEN') {
    return true;
  }
  switch (snooze.condition.kind) {
    case 'someone_replies':
      return someoneReplied(snooze, context);
    case 'new_push':
      return newPush(snooze, context);
    case 'until_time':
      return context.now >= snooze.condition.until;
    case 'muted':
      return personallyAsked(snooze, context);
  }
}

/**
 * A loud event from a human after the snooze started ends it whatever the
 * condition, so a mention is never hidden behind a snooze. Open question in
 * DESIGN.md; this is the proposed default. Human means not automation
 * (`isAutomation`): a bot-made review request that asks the viewer wakes the
 * snooze, the app's own Look closer event does not. An automation event the
 * agent raised to loud wakes it too (decided 2026-09-30); a bot event at its
 * rule's loudness never does.
 *
 * A mute is the exception: it stays whatever bots or other people do, so
 * only its own condition (`personallyAsked`) ends it.
 */
export function breaksSnooze(event: PrEvent, snooze: Snooze, context: SnoozeContext): boolean {
  if (snooze.condition.kind === 'muted') {
    return false;
  }
  if (event.at <= snooze.since || event.seenAt !== null || effectiveLoudness(event) !== 'loud') {
    return false;
  }
  return !isAutomationOn(event, context) || raisedToLoud(event);
}

/**
 * Where a PR's snooze stands. Only its start is stored: broken and over are
 * read off the PR's history on every load. So a snooze broken by a mention
 * comes back once that mention is seen (open question in DESIGN.md).
 */
export type SnoozePhase = 'active' | 'broken' | 'over';

export function snoozePhase(snooze: Snooze, context: SnoozeContext): SnoozePhase {
  if (context.events.some((event) => breaksSnooze(event, snooze, context))) {
    return 'broken';
  }
  return isSnoozeOver(snooze, context) ? 'over' : 'active';
}

/**
 * True while the PR is muted and the mute still holds: not taken back, not
 * ended by a personal ask (`personallyAsked`) or by the PR closing. Mute's
 * GitHub unsubscribe goes out only then (2026-10-06): a mention that ended
 * the mute during the undo window must not leave the thread unsubscribed.
 */
export function muteHolds(snooze: Snooze | null, context: SnoozeContext): boolean {
  return snooze !== null && snooze.condition.kind === 'muted' && snoozePhase(snooze, context) === 'active';
}

/** The user snoozing a tile ("start") or taking the snooze back ("end"). */
export type SnoozeChange = { kind: 'start'; condition: SnoozeCondition; at: IsoTime } | { kind: 'end' };

/** What a snooze change writes: snoozes to store (replacing any), and PRs whose snooze goes. */
export interface SnoozeWrites {
  put: Snooze[];
  remove: PrKey[];
}

/**
 * Snoozing a tile puts one snooze on each tracked PR in it, all with the
 * same condition and start. Pulled-in stack layers get none: they never
 * decide whether the tile is snoozed. Unsnoozing removes the snooze of every
 * PR in the tile.
 */
export function snoozeWrites(tile: Tile, change: SnoozeChange): SnoozeWrites {
  switch (change.kind) {
    case 'start': {
      const tracked = tile.members.filter((member) => isTracked(member.provenance));
      const put = tracked.map((member) => ({ prKey: member.prKey, condition: change.condition, since: change.at }));
      return { put, remove: [] };
    }
    case 'end':
      return { put: [], remove: tile.members.map((member) => member.prKey) };
  }
}

export type SnoozeTelemetryBucket = 'hours' | 'a_day' | 'days' | 'a_week' | 'someone_replies' | 'new_push' | 'muted';

/** The `snoozed` telemetry event's prop: a time bucket for `until_time`, the condition name otherwise. */
export function snoozeTelemetryBucket(condition: SnoozeCondition, nowMs: number): SnoozeTelemetryBucket {
  if (condition.kind !== 'until_time') {
    return condition.kind;
  }
  const hours = (new Date(condition.until).getTime() - nowMs) / 3_600_000;
  if (hours <= 6) {
    return 'hours';
  }
  if (hours <= 30) {
    return 'a_day';
  }
  if (hours <= 24 * 6) {
    return 'days';
  }
  return 'a_week';
}

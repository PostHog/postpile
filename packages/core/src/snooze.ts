import { isAutomation } from './bots.ts';
import { PUSH_KINDS } from './kinds.ts';
import { effectiveLoudness } from './loudness.ts';
import { sameLogin } from './mentions.ts';
import { reviewRequestTarget } from './review-request.ts';
import type { EventKind, IsoTime, Pr, PrEvent, Snooze, SnoozeCondition, Viewer } from './types.ts';

export interface SnoozeContext {
  /** The PRs in the snoozed tile. */
  prs: Pr[];
  /** Their events. */
  events: PrEvent[];
  now: IsoTime;
  /** The viewer's own replies never end a "someone replies" snooze. */
  viewer?: Viewer | null;
}

// Wider than the asks in kinds.ts on purpose: any human comment or review
// ends a "someone replies" snooze, not only one aimed at the viewer.
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

/** `isAutomation` for an event of the snoozed PRs, its request target looked up on its PR. */
function isAutomationIn(event: PrEvent, context: SnoozeContext): boolean {
  const pr = context.prs.find((candidate) => candidate.key === event.prKey);
  const target = pr === undefined ? null : reviewRequestTarget(event, pr);
  return isAutomation(event, target, context.viewer ?? null);
}

function someoneReplied(snooze: Snooze, context: SnoozeContext): boolean {
  return context.events.some(
    (event) =>
      event.at > snooze.since &&
      replyKinds.includes(event.kind) &&
      !isAutomationIn(event, context) &&
      !isByViewer(event, context.viewer ?? null),
  );
}

function newPush(snooze: Snooze, context: SnoozeContext): boolean {
  return context.events.some((event) => event.at > snooze.since && PUSH_KINDS.includes(event.kind));
}

function ciGreen(context: SnoozeContext): boolean {
  const open = context.prs.filter((pr) => pr.state === 'OPEN');
  return open.length > 0 && open.every((pr) => pr.checks.rollup === 'SUCCESS');
}

/** True once the snooze condition is met: a human reply, a push, green CI, or the time passed. */
export function isSnoozeOver(snooze: Snooze, context: SnoozeContext): boolean {
  switch (snooze.condition.kind) {
    case 'someone_replies':
      return someoneReplied(snooze, context);
    case 'new_push':
      return newPush(snooze, context);
    case 'ci_green':
      return ciGreen(context);
    case 'until_time':
      return context.now >= snooze.condition.until;
  }
}

/**
 * A loud event from a human after the snooze started ends it whatever the
 * condition, so a mention is never hidden behind a snooze. Open question in
 * DESIGN.md; this is the proposed default. Human means not automation
 * (`isAutomation`): a bot-made review request that asks the viewer wakes the
 * snooze, the app's own Look closer event does not.
 */
export function breaksSnooze(event: PrEvent, snooze: Snooze, context: SnoozeContext): boolean {
  return event.at > snooze.since && event.seenAt === null && effectiveLoudness(event) === 'loud' && !isAutomationIn(event, context);
}

export type SnoozeTelemetryBucket = 'hours' | 'a_day' | 'days' | 'a_week' | 'someone_replies' | 'new_push' | 'ci_green';

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

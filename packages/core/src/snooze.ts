import { PUSH_KINDS } from './kinds.ts';
import { effectiveLoudness } from './loudness.ts';
import { sameLogin } from './mentions.ts';
import type { EventKind, IsoTime, Pr, PrEvent, Snooze } from './types.ts';

export interface SnoozeContext {
  /** The PRs in the snoozed tile. */
  prs: Pr[];
  /** Their events. */
  events: PrEvent[];
  now: IsoTime;
  /** The viewer's own replies never end a "someone replies" snooze. */
  viewerLogin?: string;
}

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

function isByViewer(event: PrEvent, viewerLogin: string | undefined): boolean {
  return viewerLogin !== undefined && sameLogin(event.actor, viewerLogin);
}

function someoneReplied(snooze: Snooze, context: SnoozeContext): boolean {
  return context.events.some(
    (event) =>
      event.at > snooze.since &&
      !event.isBot &&
      replyKinds.includes(event.kind) &&
      !isByViewer(event, context.viewerLogin),
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
 * DESIGN.md; this is the proposed default.
 */
export function breaksSnooze(event: PrEvent, snooze: Snooze): boolean {
  return event.at > snooze.since && !event.isBot && event.seenAt === null && effectiveLoudness(event) === 'loud';
}

// What an event means to topic memory: whether it starts a dossier update,
// rides along with one, or never reaches a prompt at all. One home for every
// path that hands events to an agent or counts them as "newer" (DESIGN.md
// "Event roles"). Loudness answers a different question (does it need the
// viewer now?) and is not changed by any of this.
import { isMadeByAutomation, isMergeQueueBot } from './bots.ts';
import { PUSH_KINDS } from './kinds.ts';
import { effectiveLoudness } from './loudness.ts';
import type { EventKind, PrEvent } from './types.ts';

/**
 * - noise: never in a prompt, never starts an update, never counted as newer
 * - ride_along: goes into the prompt when something else starts an update, never starts one itself
 * - trigger: starts a dossier update and counts as a newer event
 */
export type MemoryRole = 'noise' | 'ride_along' | 'trigger';

/**
 * Changes to the PR's state start an update whoever made them, a bot
 * included: trunk merging, a bot asking a team for review, a bot approving
 * (the review state changes: approved, ready to merge). The app's Look
 * closer stays a trigger even when the events agent turned it down from
 * loud. Pushes are not here: see memoryRole.
 */
const ALWAYS_TRIGGER_KINDS: readonly EventKind[] = [
  'merged',
  'merged_without_review',
  'closed',
  'reopened',
  'ready_for_review',
  'converted_to_draft',
  'review_requested',
  'review_request_removed',
  'review_approved',
  'look_closer',
];

/**
 * Automation that only refreshes a status: deploys, merge queue moves, and a
 * bot editing a comment (the original already counted; the edit is a CI,
 * queue or summary refresh). CI results are noise from anyone.
 */
const STATUS_KINDS: readonly EventKind[] = ['deploy', 'merge_queue', 'comment_edited'];

/**
 * The role of one event, first match wins: loud is always a trigger, muted
 * and CI are always noise, a push rides along whoever made it, a person's
 * event is a trigger, then a bot's event by what it is. A push changes one
 * PR's code, not the topic's story (2026-10-05): it refreshes that PR's
 * glance (its head is in the glance hash) and the dossier reads it at its
 * next real update. Before, an agent pushing 27 times an hour rewrote the
 * dossier and left every glance in the topic out of date. A push aimed at
 * the viewer (answering their changes request) is loud and still a trigger. Other bot reviews and comments (review bots,
 * github-actions) ride along: their findings feed the glance, and the dossier reads them
 * once something real happens. "Made by automation" is the actor half of
 * `isAutomation`; the review request half does not matter here, since every
 * review request is a trigger.
 */
export function memoryRole(event: PrEvent): MemoryRole {
  const loudness = effectiveLoudness(event);
  if (loudness === 'loud') {
    return 'trigger';
  }
  if (loudness === 'muted') {
    return 'noise';
  }
  if (PUSH_KINDS.includes(event.kind)) {
    return 'ride_along';
  }
  if (!isMadeByAutomation(event) || ALWAYS_TRIGGER_KINDS.includes(event.kind)) {
    return 'trigger';
  }
  if (STATUS_KINDS.includes(event.kind) || isMergeQueueBot(event.actor)) {
    return 'noise';
  }
  return 'ride_along';
}

/** Starts a dossier update and counts as a newer event ("Out of date: 1 newer event"). */
export function isMemoryTrigger(event: PrEvent): boolean {
  return memoryRole(event) === 'trigger';
}

/** Never reaches a prompt and never counts. */
export function isMemoryNoise(event: PrEvent): boolean {
  return memoryRole(event) === 'noise';
}

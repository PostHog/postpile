// Inbox cleanup and "start fresh". Old unread GitHub threads pile up (a
// vacation, a first run on a busy account); the app offers to mark them
// read on GitHub in one call, or to leave GitHub alone and treat everything
// before a baseline as background here. Rules only, no IO; the engine and
// FakeEngine call the same functions. DESIGN.md "Inbox cleanup and start fresh".
import type { Cursor } from './memory.ts';
import type { IsoTime, NotificationThread, PrEvent } from './types.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The two cutoffs the dialog offers. */
export type CleanupAge = 14 | 30;

/** A gap this long since the last sync (vacation) makes the cleanup prominent. */
export const CLEANUP_GAP_DAYS = 5;
/** "Not now" hides the line and the banner this long. */
export const CLEANUP_SNOOZE_DAYS = 7;

/** banner: prominent at the top of the middle column; line: quiet, in the sidebar footer. */
export type CleanupLook = 'banner' | 'line' | 'none';

/** GET /api/inbox-cleanup. */
export interface InboxCleanupView {
  /** Threads unread on GitHub whose last activity is older than 14 days (after the baseline, if one is set). */
  unreadOlderThan14: number;
  unreadOlderThan30: number;
  look: CleanupLook;
  /** "Start fresh here": threads and events before it are background. Null when not set. */
  baseline: IsoTime | null;
  /** Set while "Not now" hides the cleanup. */
  hiddenUntil: IsoTime | null;
  /** A cleanup mark-read waiting for the writes lock: its cutoff. Null when none waits. */
  pendingCutoff: IsoTime | null;
}

export function daysBefore(now: IsoTime, days: number): IsoTime {
  return new Date(new Date(now).getTime() - days * DAY_MS).toISOString();
}

/** The last_read_at a "mark everything older than N days read" sends. */
export function cleanupCutoff(now: IsoTime, age: CleanupAge): IsoTime {
  return daysBefore(now, age);
}

/** Unread threads with no activity since `cutoff`, leaving out the background before the baseline. */
export function unreadOlderThan(threads: NotificationThread[], cutoff: IsoTime, baseline: IsoTime | null): number {
  return threads.filter((thread) => thread.unread && thread.updatedAt < cutoff && (baseline === null || thread.updatedAt >= baseline)).length;
}

/** First run (no sync before) or a gap of CLEANUP_GAP_DAYS or more since the last one. */
export function isLongSyncGap(previousSyncAt: IsoTime | null, now: IsoTime): boolean {
  return previousSyncAt === null || new Date(now).getTime() - new Date(previousSyncAt).getTime() >= CLEANUP_GAP_DAYS * DAY_MS;
}

export interface CleanupLookInput {
  unreadOlderThan14: number;
  prominent: boolean;
  hiddenUntil: IsoTime | null;
}

export function cleanupLook(input: CleanupLookInput, now: IsoTime): CleanupLook {
  if (input.unreadOlderThan14 === 0 || (input.hiddenUntil !== null && input.hiddenUntil > now)) {
    return 'none';
  }
  return input.prominent ? 'banner' : 'line';
}

/**
 * "Start fresh": an event from before the baseline counts as seen, stamped
 * with the baseline, so it is never unread or new since you looked. Applied
 * when reading, not stored, so clearing the baseline brings GitHub's state
 * back. Events already seen keep their time.
 */
export function applyBaseline(events: PrEvent[], baseline: IsoTime | null): PrEvent[] {
  if (baseline === null) {
    return events;
  }
  return events.map((event) => (event.seenAt === null && event.at < baseline ? { ...event, seenAt: baseline } : event));
}

/**
 * The topic's seen cursor as "since you last looked" uses it: never before
 * the baseline, so nothing older counts as new. A topic never marked seen
 * gets a cursor at the baseline.
 */
export function seenSinceBaseline(seen: Cursor | null, scope: string, baseline: IsoTime | null): Cursor | null {
  if (baseline === null) {
    return seen;
  }
  if (seen === null) {
    return { kind: 'seen', scope, seq: 0, dossierVersion: null, updatedAt: baseline };
  }
  return seen.updatedAt >= baseline ? seen : { ...seen, updatedAt: baseline };
}

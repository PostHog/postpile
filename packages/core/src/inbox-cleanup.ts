// Inbox cleanup. Old unread GitHub threads pile up (a vacation, a first run
// on a busy account); the app offers to mark them read on GitHub in one
// call. The local-only "Start fresh here" is gone (2026-09-30): it hid
// things in PostPile that stayed unread on GitHub (DESIGN.md "GitHub unread
// is PostPile unread"). Rules only, no IO; the engine and FakeEngine call the
// same functions. DESIGN.md "Inbox cleanup".
import type { IsoTime, NotificationThread } from './types.ts';

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
  /** Threads unread on GitHub whose last activity is older than 14 days. */
  unreadOlderThan14: number;
  unreadOlderThan30: number;
  look: CleanupLook;
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

/** Unread threads with no activity since `cutoff`. */
export function unreadOlderThan(threads: NotificationThread[], cutoff: IsoTime): number {
  return threads.filter((thread) => thread.unread && thread.updatedAt < cutoff).length;
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

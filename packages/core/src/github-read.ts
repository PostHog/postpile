// GitHub's per-thread read time as the app's truth for "seen". Every event
// on a thread from before that thread's last_read_at was seen on
// github.com (or in another client), whenever the app learns about it.
// Rules only, no IO. DESIGN.md "Reconciling with GitHub's read time".
import { sameLogin } from './mentions.ts';
import { unseenUpTo } from './read-plan.ts';
import type { IsoTime, NotificationThread, PrEvent } from './types.ts';

/** Unseen events at or before the thread's last read on GitHub. None when the thread was never read. */
export function eventsReadOnGitHub(events: PrEvent[], lastReadAt: IsoTime | null): string[] {
  return lastReadAt === null ? [] : unseenUpTo(events, lastReadAt);
}

/**
 * Unseen events the viewer did themselves (a merge, a close, their own
 * comment or review), for a thread that is read on GitHub. GitHub does not
 * turn a thread unread for the user's own actions, so those count as seen.
 */
export function ownEventsOnReadThread(events: PrEvent[], viewerLogin: string): PrEvent[] {
  return events.filter((event) => event.seenAt === null && event.actor !== '' && sameLogin(event.actor, viewerLogin));
}

/** How far the poll's read-threads watch overlaps its last answer, for GitHub's indexing lag and ties. */
export const WATCH_OVERLAP_MS = 60 * 1000;

/**
 * The next `since` of the poll's read-threads watch after a 200: the newest
 * thread update in the answer, less WATCH_OVERLAP_MS, never earlier than the
 * current one. Server times only, so the local clock does not matter. Until
 * something newer happens the URL stays the same and GitHub answers 304.
 */
export function nextWatchSince(since: IsoTime, threads: NotificationThread[]): IsoTime {
  let newest = since;
  for (const thread of threads) {
    if (thread.updatedAt > newest) {
      newest = thread.updatedAt;
    }
  }
  if (newest === since) {
    return since;
  }
  const overlapped = new Date(new Date(newest).getTime() - WATCH_OVERLAP_MS).toISOString();
  return overlapped > since ? overlapped : since;
}

/** One logged event of a topic, as far as the seen cursor cares. */
export interface LoggedSeen {
  seq: number;
  seen: boolean;
}

export interface SeenBoundary {
  /** The highest seq with every event of the topic up to it seen. `fromSeq` when the first one after it is unseen. */
  seq: number;
  /** Every logged event after `fromSeq` is seen. */
  caughtUp: boolean;
}

/**
 * How far "since you last looked" can move once GitHub's read times are
 * applied: up to the last event before the first unseen one. `logged` holds
 * the topic's events after `fromSeq`, in any order.
 */
export function seenBoundary(logged: LoggedSeen[], fromSeq: number): SeenBoundary {
  const ordered = logged.filter((entry) => entry.seq > fromSeq).sort((a, b) => a.seq - b.seq);
  let seq = fromSeq;
  for (const entry of ordered) {
    if (!entry.seen) {
      return { seq, caughtUp: false };
    }
    seq = entry.seq;
  }
  return { seq, caughtUp: true };
}

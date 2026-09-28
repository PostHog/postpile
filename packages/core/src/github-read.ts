// GitHub's per-thread read time as the app's truth for "seen". Every event
// on a thread from before that thread's last_read_at was seen on
// github.com (or in another client), whenever the app learns about it.
// Rules only, no IO. DESIGN.md "Reconciling with GitHub's read time".
import type { IsoTime, PrEvent } from './types.ts';

/** Unseen events at or before the thread's last read on GitHub. None when the thread was never read. */
export function eventsReadOnGitHub(events: PrEvent[], lastReadAt: IsoTime | null): string[] {
  if (lastReadAt === null) {
    return [];
  }
  return events.filter((event) => event.seenAt === null && event.at <= lastReadAt).map((event) => event.id);
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

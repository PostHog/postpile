import { seenThroughToken, type PrKey } from '@postpile/core';
import type { Store } from '@postpile/store';

/** The PR's unseen events logged at or before `seq`, as the store has them now. */
export function unseenIdsThrough(store: Store, key: PrKey, seq: number): string[] {
  return store.eventLog
    .listSince([key], 0)
    .filter((entry) => entry.seq <= seq && entry.event.seenAt === null)
    .map((entry) => entry.event.id);
}

/**
 * mark_read's token for a read of the PR now (DESIGN.md "Agents mark
 * read"): its newest event-log seq, then a hash of its unseen events up to
 * that seq, both from the store. pr_context hands it out with every answer;
 * mark_read recomputes both and refuses when either moved.
 */
export function seenThroughNow(store: Store, key: PrKey): string {
  const seq = store.eventLog.maxSeqForPr(key);
  return seenThroughToken(seq, unseenIdsThrough(store, key, seq));
}

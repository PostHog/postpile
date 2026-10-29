import { seenThroughToken, type PrKey } from '@postpile/core';
import type { Store } from '@postpile/store';

/**
 * The PR's unseen events logged at or before `seq`, as the store has them
 * now. For a PR a scout pulled in, its stored updatedAt too: marking it seen
 * covers the snapshot as of that update, and a title or description edit
 * synced after the read moves updatedAt without logging an event, so an
 * old token must not cover it (DESIGN.md "Scouts").
 */
export function unseenIdsThrough(store: Store, key: PrKey, seq: number): string[] {
  const ids = store.eventLog.unseenIdsThrough(key, seq);
  if (store.scoutedPrs.get(key) === null) {
    return ids;
  }
  const updatedAt = store.prs.get(key)?.updatedAt ?? '';
  return [...ids, `updated:${updatedAt}`];
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

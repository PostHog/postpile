import type { PendingThread, PrKey } from '@postpile/core';
import type { Store } from '@postpile/store';
import type { LocalChange } from '../mark-read-queue.ts';

/** Puts back what a mark-read changed in the app: its events turn unseen, its PRs lose handled. */
export function putBackLocalChange(store: Store, change: LocalChange): void {
  store.transaction(() => {
    store.events.clearSeen(change.eventIds);
    for (const key of change.handledKeys) {
      store.userPrStates.clearHandled(key);
    }
  });
}

/** The part of a batch's local change that belongs to one PR. */
export function localChangeForPr(store: Store, change: LocalChange, key: PrKey): LocalChange {
  const prEventIds = new Set((store.events.listForPrs([key]).get(key) ?? []).map((event) => event.id));
  return {
    eventIds: change.eventIds.filter((id) => prEventIds.has(id)),
    handledKeys: change.handledKeys.filter((candidate) => candidate === key),
  };
}

/** GitHub did not take this thread's mark-read: its PR goes back to how it was before the click. */
export function putBackNotTaken(store: Store, thread: PendingThread, change: LocalChange): void {
  if (thread.prKey !== null) {
    putBackLocalChange(store, localChangeForPr(store, change, thread.prKey));
  }
}

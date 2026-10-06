import { muteHolds, type IsoTime, type PrKey } from '@postpile/core';
import type { Store } from '@postpile/store';
import { loadViewer } from './viewer-meta.ts';

/** Whether the PR's mute still holds as the store has it now (`muteHolds`); false without the PR. */
export function muteHoldsNow(store: Store, key: PrKey, now: IsoTime): boolean {
  const pr = store.prs.get(key);
  if (!pr) {
    return false;
  }
  return muteHolds(store.snoozes.get(key), { pr, events: store.events.listForPr(key), now, viewer: loadViewer(store) });
}

import { isMemoryNoise, isMemoryTrigger, type PrEvent, type PrKey } from '@postpile/core';
import type { Store } from '@postpile/store';

function countSince(store: Store, prKeys: PrKey[], afterSeq: number, keep: (event: PrEvent) => boolean): number {
  return store.eventLog.listSince(prKeys, afterSeq).filter((entry) => keep(entry.event)).length;
}

/**
 * Trigger events (`memoryRole`) of these PRs logged after afterSeq: what
 * "N newer events" counts. A bot editing its status comment or a CI result
 * never makes memory look out of date.
 */
export function triggersSince(store: Store, prKeys: PrKey[], afterSeq: number): number {
  return countSince(store, prKeys, afterSeq, isMemoryTrigger);
}

/** Events of these PRs logged after afterSeq that are not noise: what "N new events since you last looked" counts. */
export function activitySince(store: Store, prKeys: PrKey[], afterSeq: number): number {
  return countSince(store, prKeys, afterSeq, (event) => !isMemoryNoise(event));
}

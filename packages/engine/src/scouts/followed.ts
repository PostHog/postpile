import type { FoundPr, IsoTime, PrKey } from '@postpile/core';
import type { Store } from '@postpile/store';

/** The found row a followed scouted PR keeps, so PostPile tracks it like any found PR (Unsorted until a topic). */
export function followedFound(prKey: PrKey, scoutName: string, at: IsoTime): FoundPr {
  return { prKey, via: 'followed', reason: `followed from scout "${scoutName}"`, foundAt: at };
}

/**
 * A Follow reached GitHub: the PR counts as followed from now on, and is
 * tracked right away, before any notification arrives. Only here, after
 * the write went through: a queued, pending, failed or undone Follow never
 * sets it.
 */
export function recordFollowed(store: Store, prKey: PrKey, at: IsoTime): void {
  store.transaction(() => {
    if (!store.scoutedPrs.markFollowed(prKey, at)) {
      return;
    }
    const row = store.scoutedPrs.get(prKey);
    store.foundPrs.put(followedFound(prKey, row?.scoutName ?? 'a scout', at));
  });
}

/** Every followed scouted PR as a found row: the sync's finder list replaces pr_found, so these go back in each time. */
export function followedFoundRows(store: Store, at: IsoTime): FoundPr[] {
  return store.scoutedPrs
    .listAll()
    .filter((row) => row.followedAt !== null)
    .map((row) => followedFound(row.prKey, row.scoutName, at));
}

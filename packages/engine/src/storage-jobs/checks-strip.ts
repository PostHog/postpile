// Storage job 2: removes `checks` from the stored snapshot json (2026-10-05,
// DESIGN.md "CI is not tracked"). PostPile fetches no CI since 0.21.0, and
// reads drop the old checks already (PrRepo `parsePr`), so this only gives
// the disk space back: on a heavy install about a tenth of the json.
//
// One unit is one stored snapshot, in key order: SQLite looks for the field
// and removes it in place (`json_remove`), inside the slice's transaction, so
// nothing written meanwhile is overwritten and no JS parses the blob. No
// revision moves: no read changes.
import type { Store } from '@postpile/store';
import type { StorageJob, StorageJobUnit } from './runner.ts';

/** Meta flag: the current walk stripped at least one snapshot, so another walk follows to verify. */
export const CHECKS_STRIP_STRIPPED_KEY = 'storage_job:checks_strip:stripped';

export class ChecksStripJob implements StorageJob {
  readonly name = 'checks_strip';
  readonly cursorKey = 'storage_job:checks_strip:after';
  readonly doneKey = 'storage_job:checks_strip:done';

  /**
   * The next snapshot after the cursor, its checks removed if it has any.
   * At the end of a walk that stripped something, the walk starts over: the
   * job ends only after a whole walk, unit by unit within the slice budget,
   * found nothing left. That also catches checks an older, unguarded build
   * (0.19.0 and before) wrote back behind the cursor; the revisions such a
   * build keeps say nothing about it.
   */
  step(store: Store, after: string): StorageJobUnit | null {
    let key = store.prs.nextSnapshotKey(after);
    if (key === null && store.meta.get(CHECKS_STRIP_STRIPPED_KEY) !== null) {
      store.meta.delete(CHECKS_STRIP_STRIPPED_KEY);
      key = store.prs.nextSnapshotKey('');
    }
    if (key === null) {
      return null;
    }
    const wrote = store.prs.stripChecks(key);
    if (wrote) {
      store.meta.set(CHECKS_STRIP_STRIPPED_KEY, '1');
    }
    return { key, wrote };
  }

  /**
   * Done when the last walk stripped nothing: every snapshot was read and
   * none held checks. A downgrade to a build before 0.21.0 after that can
   * write some back; reads drop them, so they only cost disk until the
   * snapshot is fetched again.
   */
  complete(store: Store): 'done' | 'again' {
    return store.meta.get(CHECKS_STRIP_STRIPPED_KEY) === null ? 'done' : 'again';
  }

  /** Snapshots that still hold checks: written back behind the walks by an older build. */
  blockedUnits(store: Store): number {
    return store.prs.countWithChecks();
  }
}

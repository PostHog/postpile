// Storage job 2: removes `checks` from the stored snapshot json (2026-10-05,
// DESIGN.md "CI is not tracked"). PostPile fetches no CI since 0.21.0, and
// reads drop the old checks already (PrRepo `parsePr`), so this only gives
// the disk space back: on a heavy install about a tenth of the json.
//
// One unit is one stored snapshot, in key order: SQLite removes the field in
// place (`json_remove`), inside the slice's transaction, so nothing written
// meanwhile is overwritten and no JS parses the blob. No revision moves: no
// read changes.
import type { Store } from '@postpile/store';
import type { StorageJob, StorageJobUnit } from './runner.ts';

/** Meta key: the store-wide revision counter when the current walk started, for the check at its end. */
export const CHECKS_STRIP_SINCE_KEY = 'storage_job:checks_strip:since';

export class ChecksStripJob implements StorageJob {
  readonly name = 'checks_strip';
  readonly cursorKey = 'storage_job:checks_strip:after';
  readonly doneKey = 'storage_job:checks_strip:done';

  step(store: Store, after: string): StorageJobUnit | null {
    if (after === '') {
      // A walk starts: what is written from here on is checked again at its end.
      store.meta.set(CHECKS_STRIP_SINCE_KEY, String(store.prs.latestRevision()));
    }
    const key = store.prs.nextSnapshotKey(after);
    if (key === null) {
      return null;
    }
    return { key, wrote: store.prs.stripChecks(key) };
  }

  /**
   * The walk went through every snapshot stored when it started. The ones
   * stored behind its cursor since then (a fetch, a local rewrite) carry a
   * newer revision: done only when none of them holds `checks`, counted
   * from the data. This build never writes them, so a failure means
   * something else did, and the walk starts over.
   */
  complete(store: Store): 'done' | 'again' {
    const since = Number(store.meta.get(CHECKS_STRIP_SINCE_KEY) ?? 0);
    if (store.prs.countChecksWrittenSince(since) > 0) {
      return 'again';
    }
    store.meta.delete(CHECKS_STRIP_SINCE_KEY);
    return 'done';
  }
}

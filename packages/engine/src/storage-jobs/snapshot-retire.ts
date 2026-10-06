// Storage job 8: retires `pr_snapshot` (DESIGN.md "PR storage"). Once
// text_rows switched reads off the json (meta `rows_ready:text`), no read
// takes it and no upsert writes it, so the table only holds disk space.
//
// One unit deletes one stored snapshot, in key order, inside the slice's
// transaction. No revision moves: no read changes. The check drops the
// table once it is empty, which is instant then; dropping it whole at
// startup would rewrite the freelist for the whole json in one go, so no
// migration does it. Migration 035 is the version barrier that keeps
// builds still reading the table from opening the database. At the end a
// WAL checkpoint gives back what the deletes left in the WAL file.
import type { Store } from '@postpile/store';
import type { StorageJob, StorageJobUnit } from './runner.ts';

export class SnapshotRetireJob implements StorageJob {
  readonly name = 'snapshot_retire';
  readonly cursorKey = 'storage_job:snapshot_retire:after';
  readonly doneKey = 'storage_job:snapshot_retire:done';

  step(store: Store, after: string): StorageJobUnit | null {
    const key = store.prs.retireNextSnapshot(after);
    return key === null ? null : { key, wrote: true };
  }

  /** Done once the table is gone: dropped here when empty, else walked once more. */
  complete(store: Store): 'done' | 'again' {
    return store.prs.dropEmptySnapshotTable() ? 'done' : 'again';
  }

  /** The deletes went through the WAL: copy it into the file and truncate it, without waiting on readers. */
  afterDone(store: Store): void {
    store.checkpointWal();
  }
}

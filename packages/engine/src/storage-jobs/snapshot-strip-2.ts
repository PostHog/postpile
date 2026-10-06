// Storage job 6: removes the activity lists (`commits`, `timeline`,
// `files`) from the stored snapshot json once reads take them from the
// rows (DESIGN.md "PR storage"). The same walk as snapshot_strip (job 4),
// under a name of its own: a done job never runs again, and job names and
// meta keys are never reused.
//
// One unit is one stored snapshot, in key order, `json_remove` in SQL
// inside the slice's transaction. No revision moves: no read changes. It
// runs only after activity_rows is done, and refuses to strip before the
// switch. At the end a WAL checkpoint gives back what the rewrite left in
// the WAL file.
import type { Store } from '@postpile/store';
import type { StorageJob, StorageJobUnit } from './runner.ts';

export class SnapshotStrip2Job implements StorageJob {
  readonly name = 'snapshot_strip_2';
  readonly cursorKey = 'storage_job:snapshot_strip_2:after';
  readonly doneKey = 'storage_job:snapshot_strip_2:done';

  step(store: Store, after: string): StorageJobUnit | null {
    const key = store.prs.nextSnapshotKey(after);
    if (key === null) {
      return null;
    }
    return { key, wrote: store.prs.stripJson('activity', key) };
  }

  complete(): 'done' {
    return 'done';
  }

  /** Copy the rewrite out of the WAL and truncate it, without waiting on readers. */
  afterDone(store: Store): void {
    store.checkpointWal();
  }
}

// Storage job 4: removes the discussion (`comments`, `threads`, `reviews`)
// from the stored snapshot json once reads take it from the rows (DESIGN.md
// "PR storage"). Upserts after the switch leave it out already; this gives
// back the space the older json holds, about half of it.
//
// One unit is one stored snapshot, in key order: SQLite removes the lists
// in place (`json_remove`), inside the slice's transaction, so nothing
// written meanwhile is overwritten and no JS parses the blob. No revision
// moves: no read changes. It runs only after discussion_rows is done, and
// refuses to strip before the switch.
//
// One walk is enough: from the switch on this build never writes the lists
// back, and builds since 0.20.0 refuse the newer schema. At the end a WAL
// checkpoint gives back what the rewrite left in the WAL file.
import type { Store } from '@postpile/store';
import type { StorageJob, StorageJobUnit } from './runner.ts';

export class SnapshotStripJob implements StorageJob {
  readonly name = 'snapshot_strip';
  readonly cursorKey = 'storage_job:snapshot_strip:after';
  readonly doneKey = 'storage_job:snapshot_strip:done';

  step(store: Store, after: string): StorageJobUnit | null {
    const key = store.prs.nextSnapshotKey(after);
    if (key === null) {
      return null;
    }
    return { key, wrote: store.prs.stripJson('discussion', key) };
  }

  complete(): 'done' {
    return 'done';
  }

  /** The WAL holds a rewrite of most of the json: copy it into the file and truncate it, without waiting on readers. */
  afterDone(store: Store): void {
    store.checkpointWal();
  }
}

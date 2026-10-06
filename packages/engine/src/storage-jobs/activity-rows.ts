// Storage job 5: fills the activity rows (commits, timeline, files;
// migration 033, DESIGN.md "PR storage") of every PR stored before this
// build, from its snapshot json. Every upsert since writes them itself, so
// the job only visits PRs whose rows_version is below the activity's.
//
// One unit is one PR, in key order. SQLite reads the three lists out of the
// json, core splits them, the rows and rows_version are written in the
// slice's transaction. No revision moves: reads take the json until the
// switch, and the rows hold the same lists.
//
// The switch comes at the end of the walk, as for discussion_rows:
// `complete` sets meta `rows_ready:activity` in the same transaction. A PR
// whose snapshot is missing or does not split keeps its version, so it is
// never taken for a PR without commits; from the switch on it counts as
// not stored and the sync fetches it again.
import type { IsoTime } from '@postpile/core';
import { ACTIVITY_READY_KEY, type Store } from '@postpile/store';
import type { StorageJob, StorageJobUnit } from './runner.ts';

export class ActivityRowsJob implements StorageJob {
  readonly name = 'activity_rows';
  readonly cursorKey = 'storage_job:activity_rows:after';
  readonly doneKey = 'storage_job:activity_rows:done';

  step(store: Store, after: string): StorageJobUnit | null {
    const key = store.prs.nextWithoutRows('activity', after);
    if (key === null) {
      return null;
    }
    return { key, wrote: store.prs.backfillActivity(key) };
  }

  /**
   * The walk went through every PR below the version, so whatever is left
   * the backfill rejected. Reads switch to the rows anyway: from then on a
   * rejected PR counts as not stored (an integrity failure), so reads leave
   * it out and the sync fetches it again, and a PR GitHub no longer has
   * never holds the switch back. The runner reports the rejected ones
   * (`blockedUnits`, storage_job_blocked).
   */
  complete(store: Store, at: IsoTime): 'done' {
    store.meta.set(ACTIVITY_READY_KEY, at);
    return 'done';
  }

  /** The stored PRs the backfill rejected: a snapshot that is missing, malformed or does not split. */
  blockedUnits(store: Store): number {
    return store.prs.countWithoutRows('activity');
  }
}

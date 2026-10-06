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
// The switch is the job's check, as for discussion_rows: once no stored PR
// is below the activity's version, `complete` sets meta
// `rows_ready:activity` in the same transaction. A PR whose snapshot is
// missing or does not split keeps its version, so the check fails and
// reads stay on the json until a fetch stores that PR again; it is never
// taken for a PR without commits.
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

  /** Done, and reads switch to the rows, once every stored PR has them. */
  complete(store: Store, at: IsoTime): 'done' | 'again' {
    if (!store.prs.allHaveRows('activity')) {
      return 'again';
    }
    store.meta.set(ACTIVITY_READY_KEY, at);
    return 'done';
  }

  /** The stored PRs still without rows: a snapshot that is missing, malformed or does not split. */
  blockedUnits(store: Store): number {
    return store.prs.countWithoutRows('activity');
  }
}

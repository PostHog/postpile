// Storage job 3: fills the discussion rows (migration 031, DESIGN.md "PR
// storage") of every PR stored before this build, from its snapshot json.
// Every upsert since writes them itself, so the job only visits PRs whose
// rows_version is still below the discussion's.
//
// One unit is one PR, in key order. SQLite reads the three lists and the
// body out of the json, core splits them, the rows and rows_version are
// written in the slice's transaction. No revision moves: reads take the
// json until the switch, and the rows hold the same discussion.
//
// The switch is the job's check: once no stored PR is left without rows,
// `complete` sets meta `rows_ready:discussion` in the same transaction and
// reads take the discussion from the rows. A PR whose snapshot is missing
// or does not split keeps its old version, so the check fails, the job is
// left incomplete, and reads stay on the json until a fetch stores that PR
// again; it is never taken for a PR without comments.
import type { IsoTime } from '@postpile/core';
import { DISCUSSION_READY_KEY, type Store } from '@postpile/store';
import type { StorageJob, StorageJobUnit } from './runner.ts';

export class DiscussionRowsJob implements StorageJob {
  readonly name = 'discussion_rows';
  readonly cursorKey = 'storage_job:discussion_rows:after';
  readonly doneKey = 'storage_job:discussion_rows:done';

  step(store: Store, after: string): StorageJobUnit | null {
    const key = store.prs.nextWithoutDiscussionRows(after);
    if (key === null) {
      return null;
    }
    return { key, wrote: store.prs.backfillDiscussion(key) };
  }

  /** Done, and reads switch to the rows, once every stored PR has them. */
  complete(store: Store, at: IsoTime): 'done' | 'again' {
    if (!store.prs.allHaveDiscussionRows()) {
      return 'again';
    }
    store.meta.set(DISCUSSION_READY_KEY, at);
    return 'done';
  }

  /** The stored PRs still without rows: a snapshot that is missing, malformed or does not split. */
  blockedUnits(store: Store): number {
    return store.prs.countWithoutDiscussionRows();
  }
}

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
// The switch comes at the end of the walk: `complete` sets meta
// `rows_ready:discussion` in the same transaction and reads take the
// discussion from the rows. A PR whose snapshot is missing or does not
// split keeps its old version: it is never taken for a PR without
// comments. From the switch on it counts as not stored, so reads leave it
// out and the sync fetches it again, whose upsert writes its rows. Until
// 0.23.0 such a PR held the switch back until a fetch stored it, which a
// PR GitHub no longer has never got (Codex review on #140).
import type { IsoTime } from '@postpile/core';
import { DISCUSSION_READY_KEY, type Store } from '@postpile/store';
import type { StorageJob, StorageJobUnit } from './runner.ts';

export class DiscussionRowsJob implements StorageJob {
  readonly name = 'discussion_rows';
  readonly cursorKey = 'storage_job:discussion_rows:after';
  readonly doneKey = 'storage_job:discussion_rows:done';

  step(store: Store, after: string): StorageJobUnit | null {
    const key = store.prs.nextWithoutRows('discussion', after);
    if (key === null) {
      return null;
    }
    return { key, wrote: store.prs.backfillDiscussion(key) };
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
    store.meta.set(DISCUSSION_READY_KEY, at);
    return 'done';
  }

  /** The stored PRs the backfill rejected: a snapshot that is missing, malformed or does not split. */
  blockedUnits(store: Store): number {
    return store.prs.countWithoutRows('discussion');
  }
}

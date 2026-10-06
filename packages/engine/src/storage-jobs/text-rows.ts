// Storage job 7: fills the text rows (the header's text columns and the
// `pr_body` row; migration 034, DESIGN.md "PR storage") of every PR stored
// before this build, from its snapshot json. Every upsert since writes them
// itself, so the job only visits PRs whose rows_version is below the
// text's.
//
// One unit is one PR, in key order, like discussion_rows and
// activity_rows: no revision moves, reads take the json until the switch.
// At the end of the walk `complete` sets meta `rows_ready:text` in the
// same transaction, and from then on no read takes anything from
// `pr_snapshot`. A PR whose snapshot is missing or lacks a field keeps its
// version: from the switch on it counts as not stored and the sync fetches
// it again.
import type { IsoTime } from '@postpile/core';
import { TEXT_READY_KEY, type Store } from '@postpile/store';
import type { StorageJob, StorageJobUnit } from './runner.ts';

export class TextRowsJob implements StorageJob {
  readonly name = 'text_rows';
  readonly cursorKey = 'storage_job:text_rows:after';
  readonly doneKey = 'storage_job:text_rows:done';

  step(store: Store, after: string): StorageJobUnit | null {
    const key = store.prs.nextWithoutRows('text', after);
    if (key === null) {
      return null;
    }
    return { key, wrote: store.prs.backfillText(key) };
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
    store.meta.set(TEXT_READY_KEY, at);
    return 'done';
  }

  /** The stored PRs the backfill rejected: a snapshot that is missing or lacks a field. */
  blockedUnits(store: Store): number {
    return store.prs.countWithoutRows('text');
  }
}

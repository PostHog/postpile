// Storage job 7: fills the text rows (the header's text columns and the
// `pr_body` row; migration 034, DESIGN.md "PR storage") of every PR stored
// before this build, from its snapshot json. Every upsert since writes them
// itself, so the job only visits PRs whose rows_version is below the
// text's.
//
// One unit is one PR, in key order, like discussion_rows and
// activity_rows: no revision moves, reads take the json until the switch.
// Once no stored PR is below the text's version, `complete` sets meta
// `rows_ready:text` in the same transaction, and from then on no read
// takes anything from `pr_snapshot`. A PR whose snapshot is missing or
// lacks a field keeps its version, so the check fails and reads stay on
// the json until a fetch stores that PR again.
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

  /** Done, and reads stop taking the json, once every stored PR has its text rows. */
  complete(store: Store, at: IsoTime): 'done' | 'again' {
    if (!store.prs.allHaveRows('text')) {
      return 'again';
    }
    store.meta.set(TEXT_READY_KEY, at);
    return 'done';
  }

  /** The stored PRs still without text rows: a snapshot that is missing or lacks a field. */
  blockedUnits(store: Store): number {
    return store.prs.countWithoutRows('text');
  }
}

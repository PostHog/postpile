import type { DatabaseSync } from 'node:sqlite';
import type { PrKey, PullIn } from '@postpile/core';
import { all, one, run } from '../sql.ts';

interface PullInRow {
  pr_key: string;
  anchor_pr_key: string;
  reason: string;
  pulled_at: string;
}

function toPullIn(row: PullInRow): PullIn {
  return { prKey: row.pr_key, anchorPrKey: row.anchor_pr_key, reason: row.reason, pulledAt: row.pulled_at };
}

/** Stack layers the sync pulled in. Rows stay when the PR later gets pinged; provenance is derived, not read from here. */
export class PullInRepo {
  constructor(private readonly db: DatabaseSync) {}

  get(prKey: PrKey): PullIn | null {
    const row = one<PullInRow>(this.db, 'SELECT * FROM pr_pull_in WHERE pr_key = ?', prKey);
    return row ? toPullIn(row) : null;
  }

  listAll(): Map<PrKey, PullIn> {
    const rows = all<PullInRow>(this.db, 'SELECT * FROM pr_pull_in ORDER BY pr_key');
    return new Map(rows.map((row) => [row.pr_key, toPullIn(row)]));
  }

  /** Insert or replace: a later sync may find the layer again from another anchor. */
  put(pullIn: PullIn): void {
    run(
      this.db,
      `INSERT INTO pr_pull_in (pr_key, anchor_pr_key, reason, pulled_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (pr_key) DO UPDATE SET
         anchor_pr_key = excluded.anchor_pr_key, reason = excluded.reason, pulled_at = excluded.pulled_at`,
      pullIn.prKey,
      pullIn.anchorPrKey,
      pullIn.reason,
      pullIn.pulledAt,
    );
  }
}

import type { DatabaseSync } from 'node:sqlite';
import type { FileEdits, LineRange, PrEdits, PrKey } from '@postpile/core';
import { all, run } from '../sql.ts';
import { inTransaction } from '../database.ts';

/** What the pass read of one PR's diff. */
export interface PrDiffInput {
  headOid: string;
  baseRef: string;
  capped: boolean;
  files: FileEdits[];
  fetchedAt: string;
}

/** An open PR whose diff is still to be read, with the head and base it has now. */
export interface WantedDiff {
  key: PrKey;
  repo: string;
  number: number;
  headOid: string;
  baseRef: string;
}

interface DiffRow {
  key: string;
  repo: string;
  base_ref: string;
  capped: number;
  path: string | null;
  ranges: string | null;
}

/** Line ranges per changed file of the open PRs (migration 037). Ranges only, never patch text. */
export class PrDiffRepo {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * Open PRs with no current diff (none stored, or one read at another head
   * or base), most recently updated first. A PR alone on its repo and base
   * branch is left out: nothing could overlap it.
   */
  openWithoutCurrentDiff(): WantedDiff[] {
    return all<{ key: string; repo: string; number: number; head_oid: string; base_ref: string }>(
      this.db,
      `SELECT p.key, p.repo, p.number, p.head_oid, p.base_ref FROM pr p
       LEFT JOIN pr_diff d ON d.pr_key = p.key
       WHERE p.state = 'OPEN'
         AND (d.pr_key IS NULL OR d.head_oid != p.head_oid OR d.base_ref != p.base_ref)
         AND EXISTS (SELECT 1 FROM pr q WHERE q.state = 'OPEN' AND q.repo = p.repo AND q.base_ref = p.base_ref AND q.key != p.key)
       ORDER BY p.updated_at DESC`,
    ).map((row) => ({ key: row.key, repo: row.repo, number: row.number, headOid: row.head_oid, baseRef: row.base_ref }));
  }

  /** The PR's diff replaced by `diff`, in one transaction. */
  replace(prKey: PrKey, diff: PrDiffInput): void {
    inTransaction(this.db, () => {
      run(this.db, 'DELETE FROM pr_diff WHERE pr_key = ?', prKey);
      run(this.db, 'INSERT INTO pr_diff (pr_key, head_oid, base_ref, capped, fetched_at) VALUES (?, ?, ?, ?, ?)', prKey, diff.headOid, diff.baseRef, diff.capped ? 1 : 0, diff.fetchedAt);
      for (const file of diff.files) {
        run(this.db, 'INSERT INTO pr_hunk (pr_key, path, ranges) VALUES (?, ?, ?)', prKey, file.path, JSON.stringify(file.ranges.map((range) => [range.start, range.end])));
      }
    });
  }

  /** The edits of every open PR whose diff is current, in PR order. */
  listOpenEdits(): PrEdits[] {
    const rows = all<DiffRow>(
      this.db,
      `SELECT p.key, p.repo, p.base_ref, d.capped, h.path, h.ranges
       FROM pr p
       JOIN pr_diff d ON d.pr_key = p.key AND d.head_oid = p.head_oid AND d.base_ref = p.base_ref
       LEFT JOIN pr_hunk h ON h.pr_key = p.key
       WHERE p.state = 'OPEN'
       ORDER BY p.repo, p.number, h.path`,
    );
    const byKey = new Map<string, PrEdits>();
    for (const row of rows) {
      let edits = byKey.get(row.key);
      if (edits === undefined) {
        edits = { prKey: row.key, repo: row.repo, baseRef: row.base_ref, files: [], capped: row.capped === 1 };
        byKey.set(row.key, edits);
      }
      if (row.path !== null && row.ranges !== null) {
        const ranges = (JSON.parse(row.ranges) as [number, number][]).map(([start, end]): LineRange => ({ start, end }));
        edits.files.push({ path: row.path, ranges });
      }
    }
    return [...byKey.values()];
  }
}

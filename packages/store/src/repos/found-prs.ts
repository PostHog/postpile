import type { DatabaseSync } from 'node:sqlite';
import type { FoundPr, FoundVia, PrKey } from '@postpile/core';
import { inTransaction } from '../database.ts';
import { all, run } from '../sql.ts';

interface FoundRow {
  pr_key: string;
  via: string;
  reason: string;
  found_at: string;
}

function toFound(row: FoundRow): FoundPr {
  return { prKey: row.pr_key, via: row.via as FoundVia, reason: row.reason, foundAt: row.found_at };
}

/** PRs the last full sync found outside the inbox. */
export class FoundPrRepo {
  constructor(private readonly db: DatabaseSync) {}

  listAll(): Map<PrKey, FoundPr> {
    const rows = all<FoundRow>(this.db, 'SELECT * FROM pr_found ORDER BY pr_key');
    return new Map(rows.map((row) => [row.pr_key, toFound(row)]));
  }

  /** The new list from a sync replaces the old one: a PR no longer found drops out. */
  replaceAll(found: FoundPr[]): void {
    inTransaction(this.db, () => {
      run(this.db, 'DELETE FROM pr_found');
      for (const entry of found) {
        run(
          this.db,
          'INSERT OR REPLACE INTO pr_found (pr_key, via, reason, found_at) VALUES (?, ?, ?, ?)',
          entry.prKey,
          entry.via,
          entry.reason,
          entry.foundAt,
        );
      }
    });
  }
}

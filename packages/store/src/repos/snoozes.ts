import type { DatabaseSync } from 'node:sqlite';
import type { PrKey, Snooze, SnoozeCondition } from '@postpile/core';
import { all, run } from '../sql.ts';

interface SnoozeRow {
  pr_key: string;
  condition_json: string;
  since: string;
}

function toSnooze(row: SnoozeRow): Snooze {
  return { prKey: row.pr_key, condition: JSON.parse(row.condition_json) as SnoozeCondition, since: row.since };
}

/** One snooze per PR (see `snoozeWrites` in core for how a tile's snooze is written). */
export class SnoozeRepo {
  constructor(private readonly db: DatabaseSync) {}

  list(): Snooze[] {
    return all<SnoozeRow>(this.db, 'SELECT * FROM pr_snooze ORDER BY since, pr_key').map(toSnooze);
  }

  /** A new snooze replaces the PR's old one. */
  put(snooze: Snooze): void {
    run(
      this.db,
      `INSERT INTO pr_snooze (pr_key, condition_json, since) VALUES (?, ?, ?)
       ON CONFLICT (pr_key) DO UPDATE SET condition_json = excluded.condition_json, since = excluded.since`,
      snooze.prKey,
      JSON.stringify(snooze.condition),
      snooze.since,
    );
  }

  remove(prKey: PrKey): void {
    run(this.db, 'DELETE FROM pr_snooze WHERE pr_key = ?', prKey);
  }
}

import type { DatabaseSync } from 'node:sqlite';
import type { Snooze, SnoozeCondition } from '@code-manager/core';
import { all, one, run } from '../sql.ts';

interface SnoozeRow {
  tile_id: string;
  condition_json: string;
  since: string;
}

function toSnooze(row: SnoozeRow): Snooze {
  return { tileId: row.tile_id, condition: JSON.parse(row.condition_json) as SnoozeCondition, since: row.since };
}

export class SnoozeRepo {
  constructor(private readonly db: DatabaseSync) {}

  get(tileId: string): Snooze | null {
    const row = one<SnoozeRow>(this.db, 'SELECT * FROM snooze WHERE tile_id = ?', tileId);
    return row ? toSnooze(row) : null;
  }

  list(): Snooze[] {
    return all<SnoozeRow>(this.db, 'SELECT * FROM snooze ORDER BY since, tile_id').map(toSnooze);
  }

  /** One snooze per tile; a new one replaces the old. */
  put(snooze: Snooze): void {
    run(
      this.db,
      `INSERT INTO snooze (tile_id, condition_json, since) VALUES (?, ?, ?)
       ON CONFLICT (tile_id) DO UPDATE SET condition_json = excluded.condition_json, since = excluded.since`,
      snooze.tileId,
      JSON.stringify(snooze.condition),
      snooze.since,
    );
  }

  remove(tileId: string): void {
    run(this.db, 'DELETE FROM snooze WHERE tile_id = ?', tileId);
  }
}

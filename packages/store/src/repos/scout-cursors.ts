import type { DatabaseSync } from 'node:sqlite';
import type { IsoTime, ScoutCursor } from '@postpile/core';
import { all, one, run } from '../sql.ts';

interface ScoutCursorRow {
  scout_id: string;
  repo: string;
  covered_through: string;
  updated_at: string;
}

function toCursor(row: ScoutCursorRow): ScoutCursor {
  return { scoutId: row.scout_id, repo: row.repo, coveredThrough: row.covered_through, updatedAt: row.updated_at };
}

/** How far each scout has covered each repo's listing (DESIGN.md "Scouts"). */
export class ScoutCursorRepo {
  constructor(private readonly db: DatabaseSync) {}

  get(scoutId: string, repo: string): ScoutCursor | null {
    const row = one<ScoutCursorRow>(this.db, 'SELECT * FROM scout_cursor WHERE scout_id = ? AND repo = ?', scoutId, repo);
    return row ? toCursor(row) : null;
  }

  listAll(): ScoutCursor[] {
    return all<ScoutCursorRow>(this.db, 'SELECT * FROM scout_cursor ORDER BY scout_id, repo').map(toCursor);
  }

  /**
   * Moves the cursor to `coveredThrough`, never back: a run that started
   * before another one finished cannot undo its coverage. The caller writes
   * it in the transaction that stores the run's judgements.
   */
  advance(scoutId: string, repo: string, coveredThrough: IsoTime, now: IsoTime): void {
    run(
      this.db,
      `INSERT INTO scout_cursor (scout_id, repo, covered_through, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (scout_id, repo) DO UPDATE SET covered_through = excluded.covered_through, updated_at = excluded.updated_at
       WHERE excluded.covered_through > scout_cursor.covered_through`,
      scoutId,
      repo,
      coveredThrough,
      now,
    );
  }
}

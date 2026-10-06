import type { DatabaseSync } from 'node:sqlite';
import type { LoggedEvent, PrKey } from '@postpile/core';
import { inTransaction } from '../database.ts';
import { all, one, placeholders, run } from '../sql.ts';
import { toEvent, type EventRow } from './events.ts';

type LoggedEventRow = EventRow & { seq: number };

/**
 * The append-only event log. A row is written the first time an event id is
 * seen and never changes. Cursors count in its seq.
 */
export class EventLogRepo {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * Logs event ids not logged yet (INSERT OR IGNORE), in the given order.
   * Called with the ids EventRepo.upsertDerived reports as new, in the same transaction.
   */
  append(events: { id: string; prKey: PrKey }[], at: string): void {
    inTransaction(this.db, () => {
      for (const event of events) {
        run(
          this.db,
          'INSERT OR IGNORE INTO event_log (event_id, pr_key, logged_at) VALUES (?, ?, ?)',
          event.id,
          event.prKey,
          at,
        );
      }
    });
  }

  /**
   * The log's high-water mark: every row so far has a seq at or below it,
   * every later one above it; 0 on a log that never had a row. Read from
   * SQLite's AUTOINCREMENT counter (`sqlite_sequence`), not `MAX(seq)`: rows
   * can leave (migration 030 deleted the CI events' rows, maybe the newest),
   * and a cursor already past the remaining maximum must never be asked to
   * move back (`CursorRepo.advance` refuses that).
   */
  maxSeq(): number {
    const row = one<{ seq: number | null }>(
      this.db,
      "SELECT max(coalesce((SELECT seq FROM sqlite_sequence WHERE name = 'event_log'), 0), coalesce((SELECT MAX(seq) FROM event_log), 0)) AS seq",
    );
    return row?.seq ?? 0;
  }

  /**
   * Events of these PRs logged after afterSeq, oldest seq first, joined with
   * pr_event. Log rows whose pr_event is gone (deleted comment) are skipped.
   */
  listSince(prKeys: PrKey[], afterSeq: number): LoggedEvent[] {
    if (prKeys.length === 0) {
      return [];
    }
    const rows = all<LoggedEventRow>(
      this.db,
      `SELECT l.seq, e.* FROM event_log l
       JOIN pr_event e ON e.id = l.event_id
       WHERE l.pr_key IN (${placeholders(prKeys.length)}) AND l.seq > ?
       ORDER BY l.seq`,
      ...prKeys,
      afterSeq,
    );
    return rows.map((row) => ({ seq: row.seq, event: toEvent(row) }));
  }

  /** Count only, for "N events since" badges without loading rows. */
  countSince(prKeys: PrKey[], afterSeq: number): number {
    if (prKeys.length === 0) {
      return 0;
    }
    const row = one<{ count: number }>(
      this.db,
      `SELECT COUNT(*) AS count FROM event_log l
       JOIN pr_event e ON e.id = l.event_id
       WHERE l.pr_key IN (${placeholders(prKeys.length)}) AND l.seq > ?`,
      ...prKeys,
      afterSeq,
    );
    return row?.count ?? 0;
  }
}

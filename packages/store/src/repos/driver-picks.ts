import type { DatabaseSync } from 'node:sqlite';
import { all, one, run } from '../sql.ts';

interface DriverPickRow {
  topic_id: string;
  driver: string;
}

/** The driver the user picked per topic (core `effectiveDriver`); a topic without a row is automatic. */
export class DriverPickRepo {
  constructor(private readonly db: DatabaseSync) {}

  get(topicId: string): string | null {
    return one<DriverPickRow>(this.db, 'SELECT * FROM topic_driver_pick WHERE topic_id = ?', topicId)?.driver ?? null;
  }

  /** Every pick, by topic id. */
  all(): Map<string, string> {
    const rows = all<DriverPickRow>(this.db, 'SELECT * FROM topic_driver_pick');
    return new Map(rows.map((row) => [row.topic_id, row.driver]));
  }

  /** A new pick replaces the old one. */
  set(topicId: string, driver: string, at: string): void {
    run(
      this.db,
      `INSERT INTO topic_driver_pick (topic_id, driver, picked_at) VALUES (?, ?, ?)
       ON CONFLICT (topic_id) DO UPDATE SET driver = excluded.driver, picked_at = excluded.picked_at`,
      topicId,
      driver,
      at,
    );
  }

  /** Reset to automatic. */
  clear(topicId: string): void {
    run(this.db, 'DELETE FROM topic_driver_pick WHERE topic_id = ?', topicId);
  }
}

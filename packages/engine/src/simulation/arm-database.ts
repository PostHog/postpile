// Dev only (`pnpm cli simulate-start`): one arm's database. It starts as a
// fresh-start copy with every PR snapshot hidden, then each round reveals
// the next batch from the full fresh-start copy, as a capped sync would
// fetch it.
import type { SimulationRound } from '@postpile/core';
import { Store } from '@postpile/store';

export class ArmDatabase {
  private constructor(
    readonly store: Store,
    readonly path: string,
  ) {}

  static open(path: string): ArmDatabase {
    return new ArmDatabase(Store.open(path), path);
  }

  close(): void {
    this.store.close();
  }

  /** Runs work with another database file attached as `source`. ATTACH cannot run inside a transaction, so this opens its own. */
  private withSource(sourcePath: string, work: () => void): void {
    this.store.db.prepare('ATTACH DATABASE ? AS source').run(sourcePath);
    try {
      this.store.transaction(work);
    } finally {
      this.store.db.exec('DETACH DATABASE source');
    }
  }

  /**
   * Removes every PR snapshot with its events, log rows, stack layers and
   * found rows. Notification threads stay: the first real sync stores every
   * notification at once and only the PR fetches are capped, and a thread
   * without a PR snapshot shows nowhere and reaches no prompt.
   */
  hidePrs(): void {
    this.store.transaction(() => {
      for (const table of ['pr_found', 'pr_pull_in', 'event_log', 'pr_event', 'pr']) {
        this.store.db.exec(`DELETE FROM ${table}`);
      }
    });
  }

  /**
   * Copies the round's PRs from the full copy: snapshot, events (with the
   * user's seen state), then their event log rows in their old order. The
   * log rows get new seqs (AUTOINCREMENT never reuses one), so they land
   * after every cursor and the digest reads them as new. Stack layer and
   * found rows come for every PR that is in now.
   */
  reveal(sourcePath: string, round: SimulationRound): void {
    const keys = JSON.stringify([...round.pinged, ...round.found, ...round.pulledIn]);
    this.withSource(sourcePath, () => {
      const db = this.store.db;
      db.prepare('INSERT OR IGNORE INTO main.pr SELECT * FROM source.pr WHERE key IN (SELECT value FROM json_each(?))').run(keys);
      db.prepare('INSERT OR IGNORE INTO main.pr_event SELECT * FROM source.pr_event WHERE pr_key IN (SELECT value FROM json_each(?))').run(keys);
      db.prepare(
        `INSERT OR IGNORE INTO main.event_log (event_id, pr_key, logged_at)
         SELECT event_id, pr_key, logged_at FROM source.event_log
         WHERE pr_key IN (SELECT value FROM json_each(?)) ORDER BY seq`,
      ).run(keys);
      db.exec(
        `INSERT OR IGNORE INTO main.pr_pull_in SELECT * FROM source.pr_pull_in
         WHERE pr_key IN (SELECT key FROM main.pr) AND anchor_pr_key IN (SELECT key FROM main.pr)`,
      );
      db.exec('INSERT OR IGNORE INTO main.pr_found SELECT * FROM source.pr_found WHERE pr_key IN (SELECT key FROM main.pr)');
    });
  }

  /**
   * Takes the leader arm's topic assignment, so every arm digests the same
   * topics: memberships are replaced to match, and a retired topic that got
   * a PR comes back, as the assignment does in the leader. A topic new here
   * gets the leader's id and name only, as the assignment creates it
   * (`newTopic`): the leader's dossiers already wrote summary, area, driver
   * and role into its row this round, and those are this arm's to write. An
   * existing row stays as this arm's dossiers left it.
   */
  copyTopicsFrom(leaderPath: string): void {
    this.withSource(leaderPath, () => {
      const db = this.store.db;
      db.exec(
        `INSERT INTO main.topic
           (id, name, summary, summary_input_hash, tailoring, driver, user_role, status, retired_at, area, created_at, updated_at)
         SELECT id, name, '', NULL, '', NULL, 'watcher', 'active', NULL, NULL, created_at, created_at FROM source.topic
         WHERE id NOT IN (SELECT id FROM main.topic)`,
      );
      db.exec(
        `UPDATE main.topic SET status = 'active', retired_at = NULL
         WHERE status = 'retired' AND id IN (
           SELECT l.topic_id FROM source.topic_membership l
           LEFT JOIN main.topic_membership m ON m.pr_key = l.pr_key
           WHERE m.pr_key IS NULL OR m.topic_id != l.topic_id
         )`,
      );
      db.exec('DELETE FROM main.topic_membership');
      db.exec('INSERT INTO main.topic_membership SELECT * FROM source.topic_membership');
    });
  }
}

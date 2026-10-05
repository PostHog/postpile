import type { DatabaseSync } from 'node:sqlite';
import type { IsoTime, MacPingRecord, Ping, PrKey } from '@postpile/core';
import { all, placeholders, run } from '../sql.ts';

interface MacPingRow {
  pr_key: string;
  ping_json: string;
  queued_at: string;
  shown_at: string | null;
}

function toRecord(row: MacPingRow): MacPingRecord {
  return { ping: JSON.parse(row.ping_json) as Ping, queuedAt: row.queued_at, shownAt: row.shown_at };
}

/** The pings PostPile holds on to, one per PR: queued for a roundup or shown and not handled yet. */
export class MacPingRepo {
  constructor(private readonly db: DatabaseSync) {}

  list(): MacPingRecord[] {
    return all<MacPingRow>(this.db, 'SELECT * FROM mac_ping ORDER BY queued_at, pr_key').map(toRecord);
  }

  /** Waits for the next roundup. A newer ping on the same PR replaces the old one and waits again. */
  queue(ping: Ping, at: IsoTime): void {
    run(
      this.db,
      `INSERT INTO mac_ping (pr_key, ping_json, queued_at, shown_at) VALUES (?, ?, ?, NULL)
       ON CONFLICT (pr_key) DO UPDATE SET ping_json = excluded.ping_json, queued_at = excluded.queued_at, shown_at = NULL`,
      ping.target.prKey,
      JSON.stringify(ping),
      at,
    );
  }

  /** Shown on the Mac now: counted by the Dock badge until handled. */
  putShown(ping: Ping, at: IsoTime): void {
    run(
      this.db,
      `INSERT INTO mac_ping (pr_key, ping_json, queued_at, shown_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (pr_key) DO UPDATE SET ping_json = excluded.ping_json, shown_at = excluded.shown_at`,
      ping.target.prKey,
      JSON.stringify(ping),
      at,
      at,
    );
  }

  markShown(prKeys: PrKey[], at: IsoTime): void {
    if (prKeys.length === 0) {
      return;
    }
    run(this.db, `UPDATE mac_ping SET shown_at = ? WHERE pr_key IN (${placeholders(prKeys.length)})`, at, ...prKeys);
  }

  remove(prKeys: PrKey[]): void {
    if (prKeys.length === 0) {
      return;
    }
    run(this.db, `DELETE FROM mac_ping WHERE pr_key IN (${placeholders(prKeys.length)})`, ...prKeys);
  }
}

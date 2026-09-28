import type { DatabaseSync } from 'node:sqlite';
import type { ActionLogEntry, ActionOrigin, ActionOutcome, LoggedAction, NewActionLogEntry } from '@postpile/core';
import { all, insertReturningId } from '../sql.ts';

interface ActionLogRow {
  id: number;
  at: string;
  action: string;
  origin: string;
  outcome: string;
  thread_id: string | null;
  pr_key: string | null;
  tile_id: string | null;
  batch: string | null;
  detail: string;
}

function toEntry(row: ActionLogRow): ActionLogEntry {
  return {
    id: row.id,
    at: row.at,
    action: row.action as LoggedAction,
    origin: row.origin as ActionOrigin,
    outcome: row.outcome as ActionOutcome,
    threadId: row.thread_id,
    prKey: row.pr_key,
    tileId: row.tile_id,
    batch: row.batch,
    detail: row.detail,
  };
}

/** Append-only log of GitHub-affecting and local read actions. */
export class ActionLogRepo {
  constructor(private readonly db: DatabaseSync) {}

  add(entry: NewActionLogEntry): number {
    return insertReturningId(
      this.db,
      `INSERT INTO action_log (at, action, origin, outcome, thread_id, pr_key, tile_id, batch, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      entry.at,
      entry.action,
      entry.origin,
      entry.outcome,
      entry.threadId,
      entry.prKey,
      entry.tileId,
      entry.batch,
      entry.detail,
    );
  }

  /** Newest first. */
  listRecent(limit: number): ActionLogEntry[] {
    return all<ActionLogRow>(this.db, 'SELECT * FROM action_log ORDER BY id DESC LIMIT ?', limit).map(toEntry);
  }

  /** The newest entry per thread id. */
  latestByThread(): Map<string, ActionLogEntry> {
    const rows = all<ActionLogRow>(
      this.db,
      'SELECT * FROM action_log WHERE id IN (SELECT MAX(id) FROM action_log WHERE thread_id IS NOT NULL GROUP BY thread_id)',
    );
    return new Map(rows.map((row) => [row.thread_id!, toEntry(row)]));
  }

  /** The newest entry per PR key. */
  latestByPrKey(): Map<string, ActionLogEntry> {
    const rows = all<ActionLogRow>(
      this.db,
      'SELECT * FROM action_log WHERE id IN (SELECT MAX(id) FROM action_log WHERE pr_key IS NOT NULL GROUP BY pr_key)',
    );
    return new Map(rows.map((row) => [row.pr_key!, toEntry(row)]));
  }

  /** The first entry per batch: the click that queued it. */
  firstOfBatches(): Map<string, ActionLogEntry> {
    const rows = all<ActionLogRow>(
      this.db,
      'SELECT * FROM action_log WHERE id IN (SELECT MIN(id) FROM action_log WHERE batch IS NOT NULL GROUP BY batch)',
    );
    return new Map(rows.map((row) => [row.batch!, toEntry(row)]));
  }
}

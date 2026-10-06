import type { DatabaseSync } from 'node:sqlite';
import type { PrKey, Snooze, SnoozeCondition } from '@postpile/core';
import { all, run } from '../sql.ts';

interface SnoozeRow {
  pr_key: string;
  condition_json: string;
  since: string;
}

/**
 * The stored condition. One this build no longer offers ("Until CI is
 * green", gone in 0.21.0) or cannot read becomes a time that already
 * passed (the snooze's start), so the snooze ends like an expired one.
 */
function conditionOf(row: SnoozeRow): SnoozeCondition {
  const expired: SnoozeCondition = { kind: 'until_time', until: row.since };
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.condition_json);
  } catch {
    return expired;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return expired;
  }
  const stored = parsed as { kind?: unknown; until?: unknown };
  if (stored.kind === 'someone_replies' || stored.kind === 'new_push') {
    return { kind: stored.kind };
  }
  if (stored.kind === 'until_time' && typeof stored.until === 'string') {
    return { kind: 'until_time', until: stored.until };
  }
  return expired;
}

function toSnooze(row: SnoozeRow): Snooze {
  return { prKey: row.pr_key, condition: conditionOf(row), since: row.since };
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

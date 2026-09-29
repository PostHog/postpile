// Snoozes belong to PRs (2026-09-29). A snooze was keyed by its tile id,
// which changes when a PR joins a stack or set, so the snooze got lost and
// could come back with the old tile. Now each tracked PR carries its own,
// and a tile is snoozed while every tracked PR in it is.
//
// Existing tile snoozes are copied to the tracked PRs of their tile:
// `pr:<key>` is that PR, `set:<id>` the set's current members, `stack:<key>`
// the stack's layers rebuilt from the stored PRs. A snooze whose tile holds
// no tracked PR any more is dropped with a log line. The old `snooze` table
// stays as it was; nothing reads it now.
import type { DatabaseSync } from 'node:sqlite';
import { buildStacks, type Pr } from '@postpile/core';

export const version = 19;

export const sql = `
CREATE TABLE pr_snooze (
  pr_key         TEXT PRIMARY KEY,
  condition_json TEXT NOT NULL,
  since          TEXT NOT NULL
);
`;

interface TileSnoozeRow {
  tile_id: string;
  condition_json: string;
  since: string;
}

function trackedKeys(db: DatabaseSync): Set<string> {
  const rows = db
    .prepare('SELECT pr_key FROM notification_thread WHERE pr_key IS NOT NULL UNION SELECT pr_key FROM pr_found')
    .all() as { pr_key: string }[];
  return new Set(rows.map((row) => row.pr_key));
}

function setMemberKeys(db: DatabaseSync, setId: string): string[] {
  const rows = db
    .prepare('SELECT pr_key FROM pr_set_member WHERE set_id = ? AND removed_at IS NULL ORDER BY position')
    .all(setId) as { pr_key: string }[];
  return rows.map((row) => row.pr_key);
}

function stackKeys(db: DatabaseSync, stackId: string): string[] {
  const rows = db.prepare('SELECT json FROM pr').all() as { json: string }[];
  const prs = rows.map((row) => JSON.parse(row.json) as Pr);
  return buildStacks(prs).find((stack) => stack.id === stackId)?.prKeys ?? [];
}

function tileKeys(db: DatabaseSync, tileId: string): string[] {
  if (tileId.startsWith('pr:')) {
    return [tileId.slice('pr:'.length)];
  }
  if (tileId.startsWith('set:')) {
    return setMemberKeys(db, tileId.slice('set:'.length));
  }
  if (tileId.startsWith('stack:')) {
    return stackKeys(db, tileId);
  }
  return [];
}

export function run(db: DatabaseSync): void {
  const tracked = trackedKeys(db);
  const snoozes = db.prepare('SELECT tile_id, condition_json, since FROM snooze ORDER BY since').all() as unknown as TileSnoozeRow[];
  // Ordered by start, so a PR in two snoozed tiles keeps the newer snooze.
  const put = db.prepare(
    `INSERT INTO pr_snooze (pr_key, condition_json, since) VALUES (?, ?, ?)
     ON CONFLICT (pr_key) DO UPDATE SET condition_json = excluded.condition_json, since = excluded.since`,
  );
  for (const snooze of snoozes) {
    const keys = tileKeys(db, snooze.tile_id).filter((key) => tracked.has(key));
    if (keys.length === 0) {
      console.warn(`migration 19: dropped the snooze of ${snooze.tile_id}, no tracked PR found for it`);
      continue;
    }
    for (const key of keys) {
      put.run(key, snooze.condition_json, snooze.since);
    }
  }
}

// DESIGN.md "Usage analytics" › Scouts: migration 046 adds
// `pr_scouted.closure_reported_at` and marks every existing row reported,
// whatever its state, so no historical exit is ever sent.
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { runMigrations } from './index.ts';

describe('migration 046', () => {
  it('marks every scouted row that exists as reported, active ones too', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(db, 45);
    const insert = db.prepare(
      `INSERT INTO pr_scouted (pr_key, scout_id, scout_name, config_version, reason, pulled_at, dismissed_at)
       VALUES (?, 'lookout', 'Lookout', 1, 'new folder', '2026-10-29T10:00:00.000Z', ?)`,
    );
    insert.run('acme/app#1', null);
    insert.run('acme/app#2', '2026-10-29T11:00:00.000Z');
    runMigrations(db, 46);

    const rows = db.prepare('SELECT pr_key, closure_reported_at FROM pr_scouted ORDER BY pr_key').all() as { pr_key: string; closure_reported_at: string | null }[];
    expect(rows.map((row) => row.pr_key)).toEqual(['acme/app#1', 'acme/app#2']);
    expect(rows.every((row) => row.closure_reported_at !== null && /^\d{4}-\d{2}-\d{2}T/.test(row.closure_reported_at))).toBe(true);
  });
});

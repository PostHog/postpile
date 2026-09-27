import { describe, expect, it } from 'vitest';
import { currentVersion, openDatabase, runMigrations } from './index.ts';

describe('migrations', () => {
  it('creates the schema on a fresh database and is idempotent', () => {
    const db = openDatabase(':memory:');
    expect(currentVersion(db)).toBe(1);
    runMigrations(db);
    expect(currentVersion(db)).toBe(1);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
    expect(tables.map((row) => row.name)).toContain('pr_glance');
    db.close();
  });
});

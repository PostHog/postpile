import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { LATEST_VERSION, Store } from './index.ts';

const dirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'postpile-ro-'));
  dirs.push(dir);
  return join(dir, 'db.sqlite');
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('Store.openReadOnly', () => {
  it('reads a migrated database and refuses writes', () => {
    const path = tempDb();
    const writer = Store.open(path);
    writer.meta.set('k', 'v');
    writer.close();

    const store = Store.openReadOnly(path);
    expect(store.meta.get('k')).toBe('v');
    expect(() => store.meta.set('k', 'w')).toThrow(/readonly/);
    store.close();
  });

  it('refuses a database of another schema version without migrating it', () => {
    const path = tempDb();
    const db = new DatabaseSync(path);
    db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    db.exec(`INSERT INTO schema_migrations (version, applied_at) VALUES (${LATEST_VERSION - 1}, 'x')`);
    db.close();

    expect(() => Store.openReadOnly(path)).toThrow(`schema version ${LATEST_VERSION - 1}, this build expects ${LATEST_VERSION}`);
    const check = new DatabaseSync(path);
    expect(check.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()).toEqual({ v: LATEST_VERSION - 1 });
    check.close();
  });

  it('refuses a missing file instead of creating it', () => {
    expect(() => Store.openReadOnly(join(tmpdir(), 'postpile-missing', 'db.sqlite'))).toThrow(/read-only/);
  });
});

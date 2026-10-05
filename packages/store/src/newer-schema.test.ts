import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { currentVersion, LATEST_VERSION, NewerDatabaseError, openDatabase, runMigrations, Store } from './index.ts';

const dirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'postpile-newer-'));
  dirs.push(dir);
  return join(dir, 'db.sqlite');
}

/**
 * A file the way a build with one more migration leaves it, in SQLite's
 * default rollback journal: openDatabase would switch it to WAL, so any
 * write on open shows in the bytes, the journal mode and a -wal file.
 */
function seedDatabase(path: string, version: number): void {
  const db = new DatabaseSync(path);
  runMigrations(db, Math.min(version, LATEST_VERSION));
  if (version > LATEST_VERSION) {
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, '2026-10-05T00:00:00.000Z');
  }
  db.prepare("INSERT INTO meta (key, value) VALUES ('viewer', 'alice')").run();
  db.close();
}

function fileHash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('a database from a newer PostPile', () => {
  it('is refused by openDatabase with the versions, and nothing is written', () => {
    const path = tempDb();
    seedDatabase(path, LATEST_VERSION + 1);
    const before = fileHash(path);

    let refused: unknown = null;
    try {
      openDatabase(path);
    } catch (error) {
      refused = error;
    }

    expect(refused).toBeInstanceOf(NewerDatabaseError);
    expect(refused).toMatchObject({ path, version: LATEST_VERSION + 1, knownVersion: LATEST_VERSION });
    expect(String(refused)).toContain('written by a newer PostPile');
    expect(fileHash(path)).toBe(before);
    expect(existsSync(`${path}-wal`)).toBe(false);
    expect(existsSync(`${path}-journal`)).toBe(false);
    const check = new DatabaseSync(path, { readOnly: true });
    expect(check.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'delete' });
    expect(check.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()).toEqual({ v: LATEST_VERSION + 1 });
    check.close();
  });

  it('is refused by Store.open and Store.openReadOnly the same way', () => {
    const path = tempDb();
    seedDatabase(path, LATEST_VERSION + 3);
    const before = fileHash(path);

    expect(() => Store.open(path)).toThrow(NewerDatabaseError);
    expect(() => Store.openReadOnly(path)).toThrow(NewerDatabaseError);
    expect(fileHash(path)).toBe(before);
  });
});

describe('a database this build knows', () => {
  it('opens at the same version and keeps its data', () => {
    const path = tempDb();
    seedDatabase(path, LATEST_VERSION);

    const store = Store.open(path);
    expect(currentVersion(store.db)).toBe(LATEST_VERSION);
    expect(store.meta.get('viewer')).toBe('alice');
    store.close();
  });

  it('migrates an older version up to this build', () => {
    const path = tempDb();
    seedDatabase(path, LATEST_VERSION - 1);

    const store = Store.open(path);
    expect(currentVersion(store.db)).toBe(LATEST_VERSION);
    expect(store.meta.get('viewer')).toBe('alice');
    store.close();
  });

  it('creates a new file', () => {
    const db = openDatabase(tempDb());
    expect(currentVersion(db)).toBe(LATEST_VERSION);
    db.close();
  });
});

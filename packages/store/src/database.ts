import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from './migrate.ts';

/**
 * Opens (or creates) the SQLite file and brings the schema up to date.
 * Pass ":memory:" in tests. WAL lets the CLI read while the desktop app writes.
 */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  runMigrations(db);
  return db;
}

/**
 * Runs fn inside a transaction, rolling back if it throws. A call inside an
 * open transaction joins it, so repositories and callers can both use this
 * without caring who started first. fn must be synchronous: node:sqlite is
 * synchronous, and an await in the middle would let other work interleave.
 */
export function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
  if (db.isTransaction) {
    return fn();
  }
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

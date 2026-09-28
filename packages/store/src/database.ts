import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LATEST_VERSION, runMigrations } from './migrate.ts';

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

/** The version recorded in the file, read without creating anything. 0 for a file without migrations. */
function recordedVersion(db: DatabaseSync): number {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
  if (!table) {
    return 0;
  }
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number | null };
  return row.version ?? 0;
}

/**
 * Opens an existing SQLite file read-only, e.g. for the CLI while the app
 * holds the lock: no migrations, no pragmas that write (WAL is already on).
 * Refuses a missing file and a schema of another version, since the queries
 * of this build only fit its own schema.
 */
export function openDatabaseReadOnly(path: string): DatabaseSync {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path, { readOnly: true });
  } catch (error) {
    throw new Error(`Cannot open ${path} read-only: ${error instanceof Error ? error.message : String(error)}`);
  }
  db.exec('PRAGMA busy_timeout = 5000');
  const version = recordedVersion(db);
  if (version !== LATEST_VERSION) {
    db.close();
    const hint = version < LATEST_VERSION ? 'open it once without --read-only (or with the app) to migrate it' : 'this build is older than the database, update it';
    throw new Error(`The database at ${path} has schema version ${version}, this build expects ${LATEST_VERSION}. Read-only access runs no migrations: ${hint}.`);
  }
  return db;
}

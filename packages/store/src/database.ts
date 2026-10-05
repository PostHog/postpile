import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LATEST_VERSION, runMigrations } from './migrate.ts';

/**
 * A database written by a newer PostPile: its schema has migrations this
 * build does not know, so this build's queries may not fit it. PostPile
 * never migrates down: the database file and its WAL are never changed.
 */
export class NewerDatabaseError extends Error {
  constructor(
    readonly path: string,
    readonly version: number,
    readonly knownVersion: number,
  ) {
    super(
      `The database at ${path} was written by a newer PostPile (schema version ${version}, this build knows up to ${knownVersion}). Update PostPile to open it. Its data was not changed.`,
    );
    this.name = 'NewerDatabaseError';
  }
}

/** The version recorded in the file, read without creating anything. 0 for a file without migrations. */
export function recordedVersion(db: DatabaseSync): number {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
  if (!table) {
    return 0;
  }
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number | null };
  return row.version ?? 0;
}

/**
 * Throws NewerDatabaseError when the file at `path` has a schema newer than
 * this build's. Reads through a read-only connection of its own: closing
 * the last read-write connection would checkpoint a WAL a newer build left
 * behind into the file, and the database file and its WAL must stay as
 * they were. A read-only reader may still create or rebuild the `-shm`
 * sidecar (SQLite's shared-memory index, no data); in a folder it cannot
 * write, with the sidecars missing, the read fails with SQLite's error
 * before the version is known: https://sqlite.org/wal.html#read_only_databases
 * No file yet is a new database.
 */
function refuseNewerSchema(path: string): void {
  if (path === ':memory:' || !existsSync(path)) {
    return;
  }
  const probe = new DatabaseSync(path, { readOnly: true });
  let version: number;
  try {
    probe.exec('PRAGMA busy_timeout = 5000');
    version = recordedVersion(probe);
  } finally {
    probe.close();
  }
  if (version > LATEST_VERSION) {
    throw new NewerDatabaseError(path, version, LATEST_VERSION);
  }
}

/**
 * Opens (or creates) the SQLite file and brings the schema up to date.
 * Pass ":memory:" in tests. WAL lets the CLI read while the desktop app writes.
 * A database from a newer PostPile is refused (NewerDatabaseError) before
 * this opens it for writing: no journal mode, no migrations, no checkpoint.
 */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  refuseNewerSchema(path);
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  // A reset WAL is reused from the start but keeps its size on disk (954 MB
  // after rewriting a heavy install's snapshots in one transaction). With a
  // limit each reset cuts it back to 64 MB: https://sqlite.org/pragma.html#pragma_journal_size_limit
  db.exec('PRAGMA journal_size_limit = 67108864');
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

/**
 * Opens an existing SQLite file read-only, e.g. for the CLI while the app
 * holds the lock: no migrations, no pragmas that write (WAL is already on).
 * Refuses a missing file and a schema of another version, since the queries
 * of this build only fit its own schema. A newer schema gets the same
 * NewerDatabaseError as openDatabase.
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
  if (version > LATEST_VERSION) {
    db.close();
    throw new NewerDatabaseError(path, version, LATEST_VERSION);
  }
  if (version !== LATEST_VERSION) {
    db.close();
    throw new Error(
      `The database at ${path} has schema version ${version}, this build expects ${LATEST_VERSION}. Read-only access runs no migrations: open it once without --read-only (or with the app) to migrate it.`,
    );
  }
  return db;
}

import type { DatabaseSync } from 'node:sqlite';
import * as init from './migrations/001_init.ts';

interface Migration {
  version: number;
  sql: string;
}

// Append new migrations here, in order. Never edit one that has shipped.
const migrations: Migration[] = [init];

export function currentVersion(db: DatabaseSync): number {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number | null };
  return row.version ?? 0;
}

export function runMigrations(db: DatabaseSync): void {
  const applied = currentVersion(db);
  for (const migration of migrations) {
    if (migration.version <= applied) {
      continue;
    }
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        migration.version,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

import type { DatabaseSync } from 'node:sqlite';
import * as init from './migrations/001_init.ts';
import * as engineMemory from './migrations/002_engine_memory.ts';
import * as factRecheck from './migrations/003_fact_recheck.ts';
import * as instructionsVersions from './migrations/004_instructions_versions.ts';
import * as topicAreas from './migrations/005_topic_areas.ts';
import * as pullIns from './migrations/006_pull_ins.ts';
import * as pingDecisions from './migrations/007_ping_decisions.ts';
import * as actionLog from './migrations/008_action_log.ts';
import * as workContext from './migrations/009_work_context.ts';
import * as dropBroughtBack from './migrations/010_drop_brought_back.ts';
import * as pendingWrite from './migrations/011_pending_write.ts';
import * as prEventOrderIndex from './migrations/012_pr_event_order_index.ts';
import * as pendingWriteKind from './migrations/013_pending_write_kind.ts';
import * as foundPr from './migrations/014_found_pr.ts';
import * as glanceKeyFiles from './migrations/015_glance_key_files.ts';

interface Migration {
  version: number;
  sql: string;
}

// Append new migrations here, in order. Never edit one that has shipped.
const migrations: Migration[] = [init, engineMemory, factRecheck, instructionsVersions, topicAreas, pullIns, pingDecisions, actionLog, workContext, dropBroughtBack, pendingWrite, prEventOrderIndex, pendingWriteKind, foundPr, glanceKeyFiles];

/** The schema version this build writes and expects. */
export const LATEST_VERSION = migrations[migrations.length - 1]!.version;

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

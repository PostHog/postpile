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
import * as dropTopicDeferred from './migrations/015_drop_topic_deferred.ts';
import * as glanceKeyFiles from './migrations/016_glance_key_files.ts';
import * as topicProposalSource from './migrations/017_topic_proposal_source.ts';
import * as cleanTopicNames from './migrations/018_clean_topic_names.ts';
import * as prSnooze from './migrations/019_pr_snooze.ts';
import * as topicRetiredAt from './migrations/020_topic_retired_at.ts';
import * as dropStartFresh from './migrations/021_drop_start_fresh.ts';
import * as prSetChange from './migrations/022_pr_set_change.ts';
import * as topicKind from './migrations/023_topic_kind.ts';
import * as topicDriverPick from './migrations/024_topic_driver_pick.ts';
import * as lesson from './migrations/025_lesson.ts';
import * as pendingCatchUp from './migrations/026_pending_catch_up.ts';
import * as macPing from './migrations/027_mac_ping.ts';
import * as prHeader from './migrations/028_pr_header.ts';
import * as snapshotRevision from './migrations/029_snapshot_revision.ts';
import * as dropCi from './migrations/030_drop_ci.ts';
import * as prDiscussion from './migrations/031_pr_discussion.ts';
import * as prEventChatter from './migrations/032_pr_event_chatter.ts';
import * as prActivity from './migrations/033_pr_activity.ts';
import * as prText from './migrations/034_pr_text.ts';
import * as retireSnapshot from './migrations/035_retire_snapshot.ts';
import * as prReviewUrl from './migrations/036_pr_review_url.ts';
import * as prDiff from './migrations/037_pr_diff.ts';

interface Migration {
  version: number;
  sql: string;
  /** A data change SQL alone cannot express, run after `sql` in the same transaction. */
  run?: (db: DatabaseSync) => void;
}

// Append new migrations here, in order. Never edit one that has shipped.
const migrations: Migration[] = [init, engineMemory, factRecheck, instructionsVersions, topicAreas, pullIns, pingDecisions, actionLog, workContext, dropBroughtBack, pendingWrite, prEventOrderIndex, pendingWriteKind, foundPr, dropTopicDeferred, glanceKeyFiles, topicProposalSource, cleanTopicNames, prSnooze, topicRetiredAt, dropStartFresh, prSetChange, topicKind, topicDriverPick, lesson, pendingCatchUp, macPing, prHeader, snapshotRevision, dropCi, prDiscussion, prEventChatter, prActivity, prText, retireSnapshot, prReviewUrl, prDiff];

/** The schema version this build writes and expects. */
export const LATEST_VERSION = migrations[migrations.length - 1]!.version;

export function currentVersion(db: DatabaseSync): number {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number | null };
  return row.version ?? 0;
}

/** Applies the migrations after the current version, up to `target` (tests stop early to seed old data). */
export function runMigrations(db: DatabaseSync, target = LATEST_VERSION): void {
  const applied = currentVersion(db);
  for (const migration of migrations) {
    if (migration.version <= applied || migration.version > target) {
      continue;
    }
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      migration.run?.(db);
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

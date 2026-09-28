import type { DatabaseSync } from 'node:sqlite';
import type { WorkContextVersion } from '@code-manager/core';
import { one, run } from '../sql.ts';

/** Versions kept; older ones are pruned on every save. */
export const WORK_CONTEXT_VERSIONS_KEPT = 30;

interface WorkContextRow {
  version: number;
  digest: string;
  input_sources: string;
  input_stats: string;
  model: string;
  created_at: string;
}

function toVersion(row: WorkContextRow): WorkContextVersion {
  return {
    version: row.version,
    digest: JSON.parse(row.digest) as WorkContextVersion['digest'],
    inputSources: JSON.parse(row.input_sources) as WorkContextVersion['inputSources'],
    inputStats: JSON.parse(row.input_stats) as WorkContextVersion['inputStats'],
    model: row.model,
    createdAt: row.created_at,
  };
}

/** Versioned "what you're working on" digests. */
export class WorkContextRepo {
  constructor(private readonly db: DatabaseSync) {}

  /** Stores the next version and prunes to the newest WORK_CONTEXT_VERSIONS_KEPT. */
  add(entry: Omit<WorkContextVersion, 'version'>): WorkContextVersion {
    const newest = one<{ version: number | null }>(this.db, 'SELECT MAX(version) AS version FROM work_context_version');
    const version = (newest?.version ?? 0) + 1;
    run(
      this.db,
      `INSERT INTO work_context_version (version, digest, input_sources, input_stats, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      version,
      JSON.stringify(entry.digest),
      JSON.stringify(entry.inputSources),
      JSON.stringify(entry.inputStats),
      entry.model,
      entry.createdAt,
    );
    run(this.db, 'DELETE FROM work_context_version WHERE version <= ?', version - WORK_CONTEXT_VERSIONS_KEPT);
    return { version, ...entry };
  }

  latest(): WorkContextVersion | null {
    const row = one<WorkContextRow>(this.db, 'SELECT * FROM work_context_version ORDER BY version DESC LIMIT 1');
    return row ? toVersion(row) : null;
  }

  get(version: number): WorkContextVersion | null {
    const row = one<WorkContextRow>(this.db, 'SELECT * FROM work_context_version WHERE version = ?', version);
    return row ? toVersion(row) : null;
  }

  count(): number {
    return one<{ n: number }>(this.db, 'SELECT COUNT(*) AS n FROM work_context_version')?.n ?? 0;
  }
}

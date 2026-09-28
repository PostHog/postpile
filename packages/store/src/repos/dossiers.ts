import type { DatabaseSync } from 'node:sqlite';
import type { Dossier, DossierFlag, DossierVersion } from '@postpile/core';
import { inTransaction } from '../database.ts';
import { all, one, placeholders, run } from '../sql.ts';

interface DossierRow {
  topic_id: string;
  version: number;
  json: string;
  flags_json: string;
  input_hash: string;
  through_seq: number;
  model: string;
  created_at: string;
}

function toVersion(row: DossierRow): DossierVersion {
  return {
    topicId: row.topic_id,
    version: row.version,
    dossier: JSON.parse(row.json) as Dossier,
    flags: JSON.parse(row.flags_json) as DossierFlag[],
    inputHash: row.input_hash,
    throughSeq: row.through_seq,
    model: row.model,
    createdAt: row.created_at,
  };
}

/** Topic dossiers. Every version is kept; the newest is the one in use. */
export class DossierRepo {
  constructor(private readonly db: DatabaseSync) {}

  latest(topicId: string): DossierVersion | null {
    const row = one<DossierRow>(
      this.db,
      'SELECT * FROM topic_dossier WHERE topic_id = ? ORDER BY version DESC LIMIT 1',
      topicId,
    );
    return row ? toVersion(row) : null;
  }

  /** Newest version per topic. Topics without a dossier are missing from the map. */
  latestMany(topicIds: string[]): Map<string, DossierVersion> {
    if (topicIds.length === 0) {
      return new Map();
    }
    const rows = all<DossierRow>(
      this.db,
      `SELECT d.* FROM topic_dossier d
       JOIN (
         SELECT topic_id, MAX(version) AS version FROM topic_dossier
         WHERE topic_id IN (${placeholders(topicIds.length)})
         GROUP BY topic_id
       ) newest ON newest.topic_id = d.topic_id AND newest.version = d.version`,
      ...topicIds,
    );
    return new Map(rows.map((row) => [row.topic_id, toVersion(row)]));
  }

  get(topicId: string, version: number): DossierVersion | null {
    const row = one<DossierRow>(
      this.db,
      'SELECT * FROM topic_dossier WHERE topic_id = ? AND version = ?',
      topicId,
      version,
    );
    return row ? toVersion(row) : null;
  }

  /** Newest first. */
  listVersions(topicId: string, limit: number): DossierVersion[] {
    return all<DossierRow>(
      this.db,
      'SELECT * FROM topic_dossier WHERE topic_id = ? ORDER BY version DESC LIMIT ?',
      topicId,
      limit,
    ).map(toVersion);
  }

  /**
   * Stores the next version. Throws unless version is latest + 1 (or 1 for the
   * first), so two writers cannot both write version N.
   */
  add(version: DossierVersion): void {
    inTransaction(this.db, () => {
      const row = one<{ version: number | null }>(
        this.db,
        'SELECT MAX(version) AS version FROM topic_dossier WHERE topic_id = ?',
        version.topicId,
      );
      const expected = (row?.version ?? 0) + 1;
      if (version.version !== expected) {
        throw new Error(`dossier ${version.topicId}: expected version ${expected}, got ${version.version}`);
      }
      run(
        this.db,
        `INSERT INTO topic_dossier (topic_id, version, json, flags_json, input_hash, through_seq, model, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        version.topicId,
        version.version,
        JSON.stringify(version.dossier),
        JSON.stringify(version.flags),
        version.inputHash,
        version.throughSeq,
        version.model,
        version.createdAt,
      );
    });
  }

  /** Number of stored versions, for pruning. */
  countVersions(topicId: string): number {
    const row = one<{ count: number }>(this.db, 'SELECT COUNT(*) AS count FROM topic_dossier WHERE topic_id = ?', topicId);
    return row?.count ?? 0;
  }

  /** Deletes all but the newest `keep` versions of a topic. Returns how many went. */
  prune(topicId: string, keep: number): number {
    return run(
      this.db,
      `DELETE FROM topic_dossier WHERE topic_id = ? AND version NOT IN (
         SELECT version FROM topic_dossier WHERE topic_id = ? ORDER BY version DESC LIMIT ?
       )`,
      topicId,
      topicId,
      keep,
    );
  }
}

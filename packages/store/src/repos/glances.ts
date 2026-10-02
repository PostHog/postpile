import type { DatabaseSync } from 'node:sqlite';
import type { Glance, KeyFile, PrKey, Verdict } from '@postpile/core';
import { all, one, placeholders, run } from '../sql.ts';

interface GlanceRow {
  pr_key: string;
  verdict: string;
  for_you: string;
  does: string;
  risk: string;
  others_said: string;
  /** JSON array of { path, why }. */
  key_files: string;
  pull_in_reason: string | null;
  dossier_version: number | null;
  input_hash: string;
  model: string;
  created_at: string;
  head_oid: string | null;
}

function toGlance(row: GlanceRow): Glance {
  return {
    prKey: row.pr_key,
    verdict: row.verdict as Verdict,
    forYou: row.for_you,
    does: row.does,
    risk: row.risk,
    othersSaid: row.others_said,
    keyFiles: JSON.parse(row.key_files) as KeyFile[],
    pullInReason: row.pull_in_reason,
    dossierVersion: row.dossier_version,
    inputHash: row.input_hash,
    model: row.model,
    createdAt: row.created_at,
    headOid: row.head_oid,
  };
}

export class GlanceRepo {
  constructor(private readonly db: DatabaseSync) {}

  get(prKey: PrKey): Glance | null {
    const row = one<GlanceRow>(this.db, 'SELECT * FROM pr_glance WHERE pr_key = ?', prKey);
    return row ? toGlance(row) : null;
  }

  getMany(prKeys: PrKey[]): Map<PrKey, Glance> {
    if (prKeys.length === 0) {
      return new Map();
    }
    const rows = all<GlanceRow>(
      this.db,
      `SELECT * FROM pr_glance WHERE pr_key IN (${placeholders(prKeys.length)})`,
      ...prKeys,
    );
    return new Map(rows.map((row) => [row.pr_key, toGlance(row)]));
  }

  /** Latest glance per PR; replaces the previous one. */
  put(glance: Glance): void {
    run(
      this.db,
      `INSERT INTO pr_glance
         (pr_key, verdict, for_you, does, risk, others_said, key_files, pull_in_reason, dossier_version, input_hash, model, created_at, head_oid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (pr_key) DO UPDATE SET
         verdict = excluded.verdict, for_you = excluded.for_you, does = excluded.does, risk = excluded.risk,
         others_said = excluded.others_said, key_files = excluded.key_files, pull_in_reason = excluded.pull_in_reason,
         dossier_version = excluded.dossier_version, input_hash = excluded.input_hash, model = excluded.model, created_at = excluded.created_at,
         head_oid = excluded.head_oid`,
      glance.prKey,
      glance.verdict,
      glance.forYou,
      glance.does,
      glance.risk,
      glance.othersSaid,
      JSON.stringify(glance.keyFiles),
      glance.pullInReason,
      glance.dossierVersion,
      glance.inputHash,
      glance.model,
      glance.createdAt,
      glance.headOid ?? null,
    );
  }
}

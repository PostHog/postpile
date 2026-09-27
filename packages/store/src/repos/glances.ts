import type { DatabaseSync } from 'node:sqlite';
import type { Glance, PrKey, Verdict } from '@code-manager/core';
import { all, one, placeholders, run } from '../sql.ts';

interface GlanceRow {
  pr_key: string;
  verdict: string;
  for_you: string;
  does: string;
  risk: string;
  others_said: string;
  pull_in_reason: string | null;
  input_hash: string;
  model: string;
  created_at: string;
}

function toGlance(row: GlanceRow): Glance {
  return {
    prKey: row.pr_key,
    verdict: row.verdict as Verdict,
    forYou: row.for_you,
    does: row.does,
    risk: row.risk,
    othersSaid: row.others_said,
    pullInReason: row.pull_in_reason,
    inputHash: row.input_hash,
    model: row.model,
    createdAt: row.created_at,
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
         (pr_key, verdict, for_you, does, risk, others_said, pull_in_reason, input_hash, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (pr_key) DO UPDATE SET
         verdict = excluded.verdict, for_you = excluded.for_you, does = excluded.does, risk = excluded.risk,
         others_said = excluded.others_said, pull_in_reason = excluded.pull_in_reason,
         input_hash = excluded.input_hash, model = excluded.model, created_at = excluded.created_at`,
      glance.prKey,
      glance.verdict,
      glance.forYou,
      glance.does,
      glance.risk,
      glance.othersSaid,
      glance.pullInReason,
      glance.inputHash,
      glance.model,
      glance.createdAt,
    );
  }
}

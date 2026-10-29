import type { DatabaseSync } from 'node:sqlite';
import type { IsoTime, PrKey, ScoutJudgement, ScoutJudgementStatus, ScoutVerdict } from '@postpile/core';
import { all, one, placeholders, run } from '../sql.ts';

interface ScoutJudgementRow {
  scout_id: string;
  pr_key: string;
  status: string;
  verdict: string | null;
  reason: string | null;
  input_hash: string | null;
  config_version: number;
  head_oid: string | null;
  observed_updated_at: string;
  attempts: number;
  last_error: string | null;
  judged_at: string | null;
}

function toJudgement(row: ScoutJudgementRow): ScoutJudgement {
  return {
    scoutId: row.scout_id,
    prKey: row.pr_key,
    status: row.status as ScoutJudgementStatus,
    verdict: row.verdict as ScoutVerdict | null,
    reason: row.reason,
    inputHash: row.input_hash,
    configVersion: row.config_version,
    headOid: row.head_oid,
    observedUpdatedAt: row.observed_updated_at,
    attempts: row.attempts,
    lastError: row.last_error,
    judgedAt: row.judged_at,
  };
}

/** Each scout's call on each PR it looked at, pending ones included (DESIGN.md "Scouts"). */
export class ScoutJudgementRepo {
  constructor(private readonly db: DatabaseSync) {}

  get(scoutId: string, prKey: PrKey): ScoutJudgement | null {
    const row = one<ScoutJudgementRow>(this.db, 'SELECT * FROM scout_judgement WHERE scout_id = ? AND pr_key = ?', scoutId, prKey);
    return row ? toJudgement(row) : null;
  }

  /** One scout's judgements of these PRs, by PR. */
  getMany(scoutId: string, prKeys: PrKey[]): Map<PrKey, ScoutJudgement> {
    if (prKeys.length === 0) {
      return new Map();
    }
    const rows = all<ScoutJudgementRow>(this.db, `SELECT * FROM scout_judgement WHERE scout_id = ? AND pr_key IN (${placeholders(prKeys.length)})`, scoutId, ...prKeys);
    return new Map(rows.map((row) => [row.pr_key, toJudgement(row)]));
  }

  /** Every scout's judgement of one PR, oldest call first: a PR's scout history. */
  forPr(prKey: PrKey): ScoutJudgement[] {
    return all<ScoutJudgementRow>(this.db, 'SELECT * FROM scout_judgement WHERE pr_key = ? ORDER BY judged_at, scout_id', prKey).map(toJudgement);
  }

  /** One scout's pending work, oldest observed first. */
  listPending(scoutId: string): ScoutJudgement[] {
    return all<ScoutJudgementRow>(this.db, "SELECT * FROM scout_judgement WHERE scout_id = ? AND status = 'pending' ORDER BY observed_updated_at, pr_key", scoutId).map(toJudgement);
  }

  /** Writes the whole row: a new judgement, or the next state of an existing one. */
  save(judgement: ScoutJudgement): void {
    run(
      this.db,
      `INSERT INTO scout_judgement (scout_id, pr_key, status, verdict, reason, input_hash, config_version, head_oid, observed_updated_at, attempts, last_error, judged_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (scout_id, pr_key) DO UPDATE SET
         status = excluded.status, verdict = excluded.verdict, reason = excluded.reason, input_hash = excluded.input_hash,
         config_version = excluded.config_version, head_oid = excluded.head_oid, observed_updated_at = excluded.observed_updated_at,
         attempts = excluded.attempts, last_error = excluded.last_error, judged_at = excluded.judged_at`,
      judgement.scoutId,
      judgement.prKey,
      judgement.status,
      judgement.verdict,
      judgement.reason,
      judgement.inputHash,
      judgement.configVersion,
      judgement.headOid,
      judgement.observedUpdatedAt,
      judgement.attempts,
      judgement.lastError,
      judgement.judgedAt,
    );
  }

  /** Retention: deletes skipped judgements whose PR was last observed updated before `cutoff`. Pulled and pending ones stay. */
  deleteSkippedBefore(cutoff: IsoTime): number {
    return run(this.db, "DELETE FROM scout_judgement WHERE verdict = 'skipped' AND observed_updated_at < ?", cutoff);
  }
}

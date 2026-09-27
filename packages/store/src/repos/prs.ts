import type { DatabaseSync } from 'node:sqlite';
import type { Pr, PrKey } from '@code-manager/core';
import { all, one, placeholders, run } from '../sql.ts';

export class PrRepo {
  constructor(private readonly db: DatabaseSync) {}

  upsert(pr: Pr, fetchedAt: string): void {
    run(
      this.db,
      `INSERT INTO pr (key, repo, number, state, base_ref, head_ref, updated_at, fetched_at, json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET
         repo = excluded.repo, number = excluded.number, state = excluded.state,
         base_ref = excluded.base_ref, head_ref = excluded.head_ref, updated_at = excluded.updated_at,
         fetched_at = excluded.fetched_at, json = excluded.json`,
      pr.key,
      pr.ref.repo,
      pr.ref.number,
      pr.state,
      pr.baseRef,
      pr.headRef,
      pr.updatedAt,
      fetchedAt,
      JSON.stringify(pr),
    );
  }

  get(key: PrKey): Pr | null {
    const row = one<{ json: string }>(this.db, 'SELECT json FROM pr WHERE key = ?', key);
    return row ? (JSON.parse(row.json) as Pr) : null;
  }

  getMany(keys: PrKey[]): Map<PrKey, Pr> {
    const result = new Map<PrKey, Pr>();
    if (keys.length === 0) {
      return result;
    }
    const rows = all<{ json: string }>(
      this.db,
      `SELECT json FROM pr WHERE key IN (${placeholders(keys.length)})`,
      ...keys,
    );
    for (const row of rows) {
      const pr = JSON.parse(row.json) as Pr;
      result.set(pr.key, pr);
    }
    return result;
  }

  /** Ordered by number. */
  listByRepo(repo: string): Pr[] {
    return all<{ json: string }>(this.db, 'SELECT json FROM pr WHERE repo = ? ORDER BY number', repo).map(
      (row) => JSON.parse(row.json) as Pr,
    );
  }

  /** Every stored PR, for stack detection across topics. */
  listAll(): Pr[] {
    return all<{ json: string }>(this.db, 'SELECT json FROM pr ORDER BY repo, number').map(
      (row) => JSON.parse(row.json) as Pr,
    );
  }

  /** updated_at per stored PR, so sync can skip PRs that did not move. */
  updatedAtByKey(): Map<PrKey, string> {
    const rows = all<{ key: string; updated_at: string }>(this.db, 'SELECT key, updated_at FROM pr');
    return new Map(rows.map((row) => [row.key, row.updated_at]));
  }
}

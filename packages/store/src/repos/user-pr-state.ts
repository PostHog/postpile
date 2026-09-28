import type { DatabaseSync } from 'node:sqlite';
import type { PrKey, UserPrState } from '@postpile/core';
import { all, one, placeholders, run } from '../sql.ts';

interface UserPrStateRow {
  pr_key: string;
  approved_at: string | null;
  approved_commit_oid: string | null;
  handled_at: string | null;
}

function toState(row: UserPrStateRow): UserPrState {
  return {
    prKey: row.pr_key,
    approvedAt: row.approved_at,
    approvedCommitOid: row.approved_commit_oid,
    handledAt: row.handled_at,
  };
}

export class UserPrStateRepo {
  constructor(private readonly db: DatabaseSync) {}

  get(prKey: PrKey): UserPrState | null {
    const row = one<UserPrStateRow>(this.db, 'SELECT * FROM user_pr_state WHERE pr_key = ?', prKey);
    return row ? toState(row) : null;
  }

  getMany(prKeys: PrKey[]): Map<PrKey, UserPrState> {
    if (prKeys.length === 0) {
      return new Map();
    }
    const rows = all<UserPrStateRow>(
      this.db,
      `SELECT * FROM user_pr_state WHERE pr_key IN (${placeholders(prKeys.length)})`,
      ...prKeys,
    );
    return new Map(rows.map((row) => [row.pr_key, toState(row)]));
  }

  markApproved(prKey: PrKey, commitOid: string, at: string): void {
    run(
      this.db,
      `INSERT INTO user_pr_state (pr_key, approved_at, approved_commit_oid) VALUES (?, ?, ?)
       ON CONFLICT (pr_key) DO UPDATE SET
         approved_at = excluded.approved_at, approved_commit_oid = excluded.approved_commit_oid`,
      prKey,
      at,
      commitOid,
    );
  }

  markHandled(prKey: PrKey, at: string): void {
    run(
      this.db,
      `INSERT INTO user_pr_state (pr_key, handled_at) VALUES (?, ?)
       ON CONFLICT (pr_key) DO UPDATE SET handled_at = excluded.handled_at`,
      prKey,
      at,
    );
  }

  /** Undo of a local mark-read inside the 6s window. */
  clearHandled(prKey: PrKey): void {
    run(this.db, 'UPDATE user_pr_state SET handled_at = NULL WHERE pr_key = ?', prKey);
  }
}

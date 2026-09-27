import type { DatabaseSync } from 'node:sqlite';
import type { PrKey, PrSet, PrSetMember, PrSetStatus } from '@code-manager/core';
import { inTransaction } from '../database.ts';
import { all, one, run } from '../sql.ts';

interface SetRow {
  id: string;
  topic_id: string;
  title: string;
  take: string;
  status: string;
  input_hash: string;
  created_at: string;
  updated_at: string;
}

interface MemberRow {
  set_id: string;
  pr_key: string;
  reason: string;
}

export class PrSetRepo {
  constructor(private readonly db: DatabaseSync) {}

  private membersOf(setId: string): PrSetMember[] {
    return all<MemberRow>(
      this.db,
      'SELECT set_id, pr_key, reason FROM pr_set_member WHERE set_id = ? ORDER BY position',
      setId,
    ).map((row) => ({ prKey: row.pr_key, reason: row.reason }));
  }

  private toSet(row: SetRow): PrSet {
    return {
      id: row.id,
      topicId: row.topic_id,
      title: row.title,
      take: row.take,
      members: this.membersOf(row.id),
      status: row.status as PrSetStatus,
      inputHash: row.input_hash,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /** Insert or replace the set and all of its members. */
  save(set: PrSet): void {
    inTransaction(this.db, () => {
      run(
        this.db,
        `INSERT INTO pr_set (id, topic_id, title, take, status, input_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           topic_id = excluded.topic_id, title = excluded.title, take = excluded.take,
           status = excluded.status, input_hash = excluded.input_hash, updated_at = excluded.updated_at`,
        set.id,
        set.topicId,
        set.title,
        set.take,
        set.status,
        set.inputHash,
        set.createdAt,
        set.updatedAt,
      );
      run(this.db, 'DELETE FROM pr_set_member WHERE set_id = ?', set.id);
      set.members.forEach((member, position) => {
        run(
          this.db,
          'INSERT INTO pr_set_member (set_id, pr_key, reason, position) VALUES (?, ?, ?, ?)',
          set.id,
          member.prKey,
          member.reason,
          position,
        );
      });
    });
  }

  get(id: string): PrSet | null {
    const row = one<SetRow>(this.db, 'SELECT * FROM pr_set WHERE id = ?', id);
    return row ? this.toSet(row) : null;
  }

  listActiveForTopic(topicId: string): PrSet[] {
    return all<SetRow>(
      this.db,
      "SELECT * FROM pr_set WHERE topic_id = ? AND status = 'active' ORDER BY created_at, id",
      topicId,
    ).map((row) => this.toSet(row));
  }

  /** All statuses, so regrouping can see what the user already dissolved. */
  listForTopic(topicId: string): PrSet[] {
    return all<SetRow>(this.db, 'SELECT * FROM pr_set WHERE topic_id = ? ORDER BY created_at, id', topicId).map(
      (row) => this.toSet(row),
    );
  }

  /** Active sets that contain a PR, for "which tiles is this PR in". */
  listActiveForPr(prKey: PrKey): PrSet[] {
    return all<SetRow>(
      this.db,
      `SELECT s.* FROM pr_set s
       JOIN pr_set_member m ON m.set_id = s.id
       WHERE m.pr_key = ? AND s.status = 'active'
       ORDER BY s.created_at, s.id`,
      prKey,
    ).map((row) => this.toSet(row));
  }

  /**
   * User said "not related" about one member. A set left with fewer than two
   * members is no longer a set, so it gets dissolved.
   */
  removeMember(setId: string, prKey: PrKey, at: string): void {
    inTransaction(this.db, () => {
      run(this.db, 'DELETE FROM pr_set_member WHERE set_id = ? AND pr_key = ?', setId, prKey);
      const left = one<{ count: number }>(
        this.db,
        'SELECT COUNT(*) AS count FROM pr_set_member WHERE set_id = ?',
        setId,
      );
      const status = (left?.count ?? 0) < 2 ? 'dissolved' : 'active';
      run(this.db, 'UPDATE pr_set SET status = ?, updated_at = ? WHERE id = ?', status, at, setId);
    });
  }

  /** Hard delete, for an agent set the agent itself dropped on regroup. User-dissolved sets use dissolve. */
  delete(id: string): void {
    run(this.db, 'DELETE FROM pr_set WHERE id = ?', id);
  }

  /** Keeps the row and its members so the agent remembers not to regroup them. */
  dissolve(id: string, at: string): void {
    run(this.db, "UPDATE pr_set SET status = 'dissolved', updated_at = ? WHERE id = ?", at, id);
  }
}

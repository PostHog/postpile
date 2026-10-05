import type { DatabaseSync } from 'node:sqlite';
import type { PrKey, PrSet, PrSetChange, PrSetChangeBy, PrSetChangeKind, PrSetMember, PrSetStatus } from '@postpile/core';
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

interface ChangeRow {
  set_id: string;
  topic_id: string;
  pr_key: string | null;
  change: string;
  reason: string;
  by: string;
  at: string;
}

function toChange(row: ChangeRow): PrSetChange {
  return {
    setId: row.set_id,
    topicId: row.topic_id,
    prKey: row.pr_key,
    kind: row.change as PrSetChangeKind,
    reason: row.reason,
    by: row.by as PrSetChangeBy,
    at: row.at,
  };
}

export class PrSetRepo {
  constructor(private readonly db: DatabaseSync) {}

  private membersOf(setId: string): PrSetMember[] {
    return all<MemberRow>(
      this.db,
      'SELECT set_id, pr_key, reason FROM pr_set_member WHERE set_id = ? AND removed_at IS NULL ORDER BY position',
      setId,
    ).map((row) => ({ prKey: row.pr_key, reason: row.reason }));
  }

  private removedKeysOf(setId: string): PrKey[] {
    return all<MemberRow>(
      this.db,
      'SELECT set_id, pr_key, reason FROM pr_set_member WHERE set_id = ? AND removed_at IS NOT NULL ORDER BY removed_at',
      setId,
    ).map((row) => row.pr_key);
  }

  private toSet(row: SetRow): PrSet {
    return {
      id: row.id,
      topicId: row.topic_id,
      title: row.title,
      take: row.take,
      members: this.membersOf(row.id),
      removedKeys: this.removedKeysOf(row.id),
      status: row.status as PrSetStatus,
      inputHash: row.input_hash,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Insert or replace the set and its members. set.removedKeys is not written:
   * only removeMember records a removal, and a removed PR stays removed even
   * if `members` lists it again.
   */
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
      run(this.db, 'DELETE FROM pr_set_member WHERE set_id = ? AND removed_at IS NULL', set.id);
      set.members.forEach((member, position) => {
        run(
          this.db,
          `INSERT INTO pr_set_member (set_id, pr_key, reason, position) VALUES (?, ?, ?, ?)
           ON CONFLICT (set_id, pr_key) DO NOTHING`,
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

  /** The current members of every active set, one list per set: the hot board loads a set whole or not at all. */
  activeMemberGroups(): PrKey[][] {
    const rows = all<{ set_id: string; pr_key: string }>(
      this.db,
      `SELECT m.set_id, m.pr_key FROM pr_set_member m
       JOIN pr_set s ON s.id = m.set_id
       WHERE s.status = 'active' AND m.removed_at IS NULL
       ORDER BY m.set_id, m.position`,
    );
    const groups = new Map<string, PrKey[]>();
    for (const row of rows) {
      const members = groups.get(row.set_id) ?? [];
      members.push(row.pr_key);
      groups.set(row.set_id, members);
    }
    return [...groups.values()];
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
   * User said "not related" about one member. The row is kept, marked
   * removed, so regrouping remembers it. A set left with fewer than two
   * members is no longer a set, so it gets dissolved.
   */
  removeMember(setId: string, prKey: PrKey, at: string): void {
    inTransaction(this.db, () => {
      run(this.db, 'UPDATE pr_set_member SET removed_at = ? WHERE set_id = ? AND pr_key = ?', at, setId, prKey);
      const left = one<{ count: number }>(
        this.db,
        'SELECT COUNT(*) AS count FROM pr_set_member WHERE set_id = ? AND removed_at IS NULL',
        setId,
      );
      const status = (left?.count ?? 0) < 2 ? 'dissolved' : 'active';
      run(this.db, 'UPDATE pr_set SET status = ?, updated_at = ? WHERE id = ?', status, at, setId);
    });
  }

  /**
   * Records "not related" for a PR that was never a member here: a merge
   * carries the merged-away set's corrections over, so they keep holding.
   */
  addRemoved(setId: string, prKey: PrKey, at: string): void {
    run(
      this.db,
      `INSERT INTO pr_set_member (set_id, pr_key, reason, position, removed_at) VALUES (?, ?, '', -1, ?)
       ON CONFLICT (set_id, pr_key) DO UPDATE SET removed_at = excluded.removed_at`,
      setId,
      prKey,
      at,
    );
  }

  /** Hard delete, for an agent set the agent itself dropped on regroup. User-dissolved sets use dissolve. */
  delete(id: string): void {
    run(this.db, 'DELETE FROM pr_set WHERE id = ?', id);
  }

  /** Keeps the row and its members so the agent remembers not to regroup them. */
  dissolve(id: string, at: string): void {
    run(this.db, "UPDATE pr_set SET status = 'dissolved', updated_at = ? WHERE id = ?", at, id);
  }

  /** One line of a set's history. Every change to a set's members writes one. */
  recordChange(change: PrSetChange): void {
    run(
      this.db,
      'INSERT INTO pr_set_change (set_id, topic_id, pr_key, change, reason, by, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      change.setId,
      change.topicId,
      change.prKey,
      change.kind,
      change.reason,
      change.by,
      change.at,
    );
  }

  /** The topic's set history, newest first, ended sets included. */
  listChangesForTopic(topicId: string, limit: number): PrSetChange[] {
    return all<ChangeRow>(
      this.db,
      'SELECT set_id, topic_id, pr_key, change, reason, by, at FROM pr_set_change WHERE topic_id = ? ORDER BY id DESC LIMIT ?',
      topicId,
      limit,
    ).map(toChange);
  }
}

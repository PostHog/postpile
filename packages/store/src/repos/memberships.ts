import type { DatabaseSync } from 'node:sqlite';
import type { AssignedBy, PrKey, TopicMembership } from '@code-manager/core';
import { all, one, run } from '../sql.ts';

interface MembershipRow {
  pr_key: string;
  topic_id: string;
  assigned_by: string;
  reason: string;
  created_at: string;
}

function toMembership(row: MembershipRow): TopicMembership {
  return {
    prKey: row.pr_key,
    topicId: row.topic_id,
    assignedBy: row.assigned_by as AssignedBy,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

export class TopicMembershipRepo {
  constructor(private readonly db: DatabaseSync) {}

  /** Insert or replace. A user assignment must never be replaced by an agent one; callers check. */
  assign(membership: TopicMembership): void {
    run(
      this.db,
      `INSERT INTO topic_membership (pr_key, topic_id, assigned_by, reason, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (pr_key) DO UPDATE SET
         topic_id = excluded.topic_id, assigned_by = excluded.assigned_by,
         reason = excluded.reason, created_at = excluded.created_at`,
      membership.prKey,
      membership.topicId,
      membership.assignedBy,
      membership.reason,
      membership.createdAt,
    );
  }

  get(prKey: PrKey): TopicMembership | null {
    const row = one<MembershipRow>(this.db, 'SELECT * FROM topic_membership WHERE pr_key = ?', prKey);
    return row ? toMembership(row) : null;
  }

  /** Oldest first. */
  listForTopic(topicId: string): TopicMembership[] {
    return all<MembershipRow>(
      this.db,
      'SELECT * FROM topic_membership WHERE topic_id = ? ORDER BY created_at, pr_key',
      topicId,
    ).map(toMembership);
  }

  listAll(): TopicMembership[] {
    return all<MembershipRow>(this.db, 'SELECT * FROM topic_membership ORDER BY created_at, pr_key').map(toMembership);
  }

  /** PR keys that have a stored PR but no topic yet. */
  listUnassignedPrKeys(): PrKey[] {
    return all<{ key: string }>(
      this.db,
      `SELECT pr.key FROM pr
       LEFT JOIN topic_membership m ON m.pr_key = pr.key
       WHERE m.pr_key IS NULL
       ORDER BY pr.repo, pr.number`,
    ).map((row) => row.key);
  }

  remove(prKey: PrKey): void {
    run(this.db, 'DELETE FROM topic_membership WHERE pr_key = ?', prKey);
  }

  /** Moves every PR of one topic to another, after an accepted merge proposal. */
  moveAll(fromTopicId: string, toTopicId: string): void {
    run(this.db, 'UPDATE topic_membership SET topic_id = ? WHERE topic_id = ?', toTopicId, fromTopicId);
  }
}

import type { DatabaseSync } from 'node:sqlite';
import type { Topic, TopicStatus, UserRole } from '@code-manager/core';
import { all, one, run } from '../sql.ts';

interface TopicRow {
  id: string;
  name: string;
  summary: string;
  summary_input_hash: string | null;
  tailoring: string;
  driver: string | null;
  user_role: string;
  status: string;
  area: string | null;
  created_at: string;
  updated_at: string;
}

function toTopic(row: TopicRow): Topic {
  return {
    id: row.id,
    name: row.name,
    summary: row.summary,
    summaryInputHash: row.summary_input_hash,
    tailoring: row.tailoring,
    driver: row.driver,
    userRole: row.user_role as UserRole,
    status: row.status as TopicStatus,
    area: row.area,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class TopicRepo {
  constructor(private readonly db: DatabaseSync) {}

  create(topic: Topic): void {
    run(
      this.db,
      `INSERT INTO topic
         (id, name, summary, summary_input_hash, tailoring, driver, user_role, status, area, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      topic.id,
      topic.name,
      topic.summary,
      topic.summaryInputHash,
      topic.tailoring,
      topic.driver,
      topic.userRole,
      topic.status,
      topic.area,
      topic.createdAt,
      topic.updatedAt,
    );
  }

  get(id: string): Topic | null {
    const row = one<TopicRow>(this.db, 'SELECT * FROM topic WHERE id = ?', id);
    return row ? toTopic(row) : null;
  }

  /** Oldest first, all statuses. */
  list(): Topic[] {
    return all<TopicRow>(this.db, 'SELECT * FROM topic ORDER BY created_at, id').map(toTopic);
  }

  listActive(): Topic[] {
    return all<TopicRow>(this.db, "SELECT * FROM topic WHERE status = 'active' ORDER BY created_at, id").map(toTopic);
  }

  updateSummary(id: string, summary: string, inputHash: string, at: string): void {
    run(
      this.db,
      'UPDATE topic SET summary = ?, summary_input_hash = ?, updated_at = ? WHERE id = ?',
      summary,
      inputHash,
      at,
      id,
    );
  }

  /** Only called after the user confirmed "keep it". */
  setTailoring(id: string, tailoring: string, at: string): void {
    run(this.db, 'UPDATE topic SET tailoring = ?, updated_at = ? WHERE id = ?', tailoring, at, id);
  }

  /** Only called when the user accepted a rename proposal. */
  rename(id: string, name: string, at: string): void {
    run(this.db, 'UPDATE topic SET name = ?, updated_at = ? WHERE id = ?', name, at, id);
  }

  setDriverAndRole(id: string, driver: string | null, userRole: UserRole, at: string): void {
    run(this.db, 'UPDATE topic SET driver = ?, user_role = ?, updated_at = ? WHERE id = ?', driver, userRole, at, id);
  }

  setArea(id: string, area: string | null, at: string): void {
    run(this.db, 'UPDATE topic SET area = ?, updated_at = ? WHERE id = ?', area, at, id);
  }

  /** Folds one area into another, for an accepted area_merge proposal. Returns how many topics moved. */
  renameArea(from: string, into: string, at: string): number {
    return run(this.db, 'UPDATE topic SET area = ?, updated_at = ? WHERE area = ?', into, at, from);
  }

  /** Archive after a merge proposal was accepted. The id is never reused. */
  setStatus(id: string, status: TopicStatus, at: string): void {
    run(this.db, 'UPDATE topic SET status = ?, updated_at = ? WHERE id = ?', status, at, id);
  }
}

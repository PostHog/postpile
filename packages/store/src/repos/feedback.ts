import type { DatabaseSync } from 'node:sqlite';
import type { Feedback, FeedbackKind } from '@postpile/core';
import { all, insertReturningId, run } from '../sql.ts';

export type NewFeedback = Omit<Feedback, 'id'>;

interface FeedbackRow {
  id: number;
  kind: string;
  topic_id: string | null;
  tile_id: string | null;
  pr_key: string | null;
  set_id: string | null;
  event_id: string | null;
  note: string;
  created_at: string;
}

function toFeedback(row: FeedbackRow): Feedback {
  return {
    id: row.id,
    kind: row.kind as FeedbackKind,
    topicId: row.topic_id,
    tileId: row.tile_id,
    prKey: row.pr_key,
    setId: row.set_id,
    eventId: row.event_id,
    note: row.note,
    createdAt: row.created_at,
  };
}

/** Append-only log of user corrections. */
export class FeedbackRepo {
  constructor(private readonly db: DatabaseSync) {}

  add(feedback: NewFeedback): Feedback {
    const id = insertReturningId(
      this.db,
      `INSERT INTO feedback (kind, topic_id, tile_id, pr_key, set_id, event_id, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      feedback.kind,
      feedback.topicId,
      feedback.tileId,
      feedback.prKey,
      feedback.setId,
      feedback.eventId,
      feedback.note,
      feedback.createdAt,
    );
    return { id, ...feedback };
  }

  /**
   * The one exception to append-only: undoing a memory correction inside its
   * undo window takes the row back, as if the click never happened.
   */
  delete(id: number): void {
    run(this.db, 'DELETE FROM feedback WHERE id = ?', id);
  }

  /** Newest first. Fed back into prompts for that topic. */
  recentForTopic(topicId: string, limit: number): Feedback[] {
    return all<FeedbackRow>(
      this.db,
      'SELECT * FROM feedback WHERE topic_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
      topicId,
      limit,
    ).map(toFeedback);
  }

  /** Newest first, across topics. For prompts that have no topic yet (assignment). */
  recent(limit: number): Feedback[] {
    return all<FeedbackRow>(this.db, 'SELECT * FROM feedback ORDER BY created_at DESC, id DESC LIMIT ?', limit).map(
      toFeedback,
    );
  }

  /** Newest first, one kind across topics. */
  listByKind(kind: FeedbackKind, limit: number): Feedback[] {
    return all<FeedbackRow>(
      this.db,
      'SELECT * FROM feedback WHERE kind = ? ORDER BY created_at DESC, id DESC LIMIT ?',
      kind,
      limit,
    ).map(toFeedback);
  }

  /** Everything said about one PR, e.g. "not mine" before re-offering it. */
  listForPr(prKey: string): Feedback[] {
    return all<FeedbackRow>(this.db, 'SELECT * FROM feedback WHERE pr_key = ? ORDER BY created_at, id', prKey).map(
      toFeedback,
    );
  }
}

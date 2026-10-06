import type { DatabaseSync } from 'node:sqlite';
import type { Lesson, LessonGlance, LessonMismatch, LessonReview, LessonSource, LessonStatus, NewLesson, PrKey } from '@postpile/core';
import { all, insertReturningId, one, run } from '../sql.ts';

interface LessonRow {
  id: number;
  topic_id: string | null;
  pr_key: string;
  source: string;
  mismatch: string | null;
  glance_json: string | null;
  review_id: string | null;
  review_json: string | null;
  note: string;
  text: string;
  why: string;
  joined_id: number | null;
  status: string;
  created_at: string;
  decided_at: string | null;
}

function toLesson(row: LessonRow): Lesson {
  return {
    id: row.id,
    topicId: row.topic_id,
    prKey: row.pr_key,
    source: row.source as LessonSource,
    mismatch: row.mismatch as LessonMismatch | null,
    glance: row.glance_json === null ? null : (JSON.parse(row.glance_json) as LessonGlance),
    review: row.review_json === null ? null : (JSON.parse(row.review_json) as LessonReview),
    note: row.note,
    text: row.text,
    why: row.why,
    joinedId: row.joined_id,
    status: row.status as LessonStatus,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

const PENDING = "status IN ('new', 'open')";
/** Still follow their review: pending ones, and those that joined an open line (they count as its evidence). */
const FOLLOWS_REVIEW = "status IN ('new', 'open', 'joined')";

/** Lessons from the user's pushback. One row per change request (review_id is unique), or per taught note. */
export class LessonRepo {
  constructor(private readonly db: DatabaseSync) {}

  get(id: number): Lesson | null {
    const row = one<LessonRow>(this.db, 'SELECT * FROM lesson WHERE id = ?', id);
    return row ? toLesson(row) : null;
  }

  hasReview(reviewId: string): boolean {
    return one<{ id: number }>(this.db, 'SELECT id FROM lesson WHERE review_id = ?', reviewId) !== null;
  }

  add(lesson: NewLesson): Lesson {
    const id = insertReturningId(
      this.db,
      `INSERT INTO lesson
         (topic_id, pr_key, source, mismatch, glance_json, review_id, review_json, note, text, why, joined_id, status, created_at, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      lesson.topicId,
      lesson.prKey,
      lesson.source,
      lesson.mismatch,
      lesson.glance === null ? null : JSON.stringify(lesson.glance),
      lesson.review?.id ?? null,
      lesson.review === null ? null : JSON.stringify(lesson.review),
      lesson.note,
      lesson.text,
      lesson.why,
      lesson.joinedId,
      lesson.status,
      lesson.createdAt,
      lesson.decidedAt,
    );
    return { ...lesson, id };
  }

  /** Waiting on the agent or the user, or joined to an open line, for one PR: what still follows its review. */
  listFollowingReviewForPr(prKey: PrKey): Lesson[] {
    return all<LessonRow>(this.db, `SELECT * FROM lesson WHERE pr_key = ? AND ${FOLLOWS_REVIEW} ORDER BY id`, prKey).map(toLesson);
  }

  /** Waiting on the agent or the user, everywhere. */
  listPending(): Lesson[] {
    return all<LessonRow>(this.db, `SELECT * FROM lesson WHERE ${PENDING} ORDER BY id`).map(toLesson);
  }

  /** Waiting on the agent to write the line, oldest first. */
  listNew(): Lesson[] {
    return all<LessonRow>(this.db, "SELECT * FROM lesson WHERE status = 'new' ORDER BY id").map(toLesson);
  }

  /** Shown in the topic, oldest first. */
  listOpenForTopic(topicId: string): Lesson[] {
    return all<LessonRow>(this.db, "SELECT * FROM lesson WHERE topic_id = ? AND status = 'open' ORDER BY id", topicId).map(toLesson);
  }

  /** Lines the user turned down, newest first. A dismissed line must not come back. */
  listDismissedTexts(limit: number): string[] {
    return all<{ text: string }>(
      this.db,
      "SELECT text FROM lesson WHERE status = 'dismissed' AND text != '' ORDER BY decided_at DESC, id DESC LIMIT ?",
      limit,
    ).map((row) => row.text);
  }

  /** Every line the user ever dismissed. The "never again" check reads all of them, the prompt only the newest. */
  listAllDismissedTexts(): string[] {
    return all<{ text: string }>(this.db, "SELECT text FROM lesson WHERE status = 'dismissed' AND text != ''").map((row) => row.text);
  }

  /** How many lessons joined each of these, as extra evidence. */
  joinedCounts(ids: number[]): Map<number, number> {
    const counts = new Map<number, number>();
    if (ids.length === 0) {
      return counts;
    }
    const rows = all<{ joined_id: number; n: number }>(
      this.db,
      `SELECT joined_id, COUNT(*) AS n FROM lesson WHERE status = 'joined' AND joined_id IN (${ids.map(() => '?').join(', ')}) GROUP BY joined_id`,
      ...ids,
    );
    for (const row of rows) {
      counts.set(row.joined_id, row.n);
    }
    return counts;
  }

  /** Taught lessons created since `since`, for the daily cap. */
  countTaughtSince(since: string): number {
    return one<{ n: number }>(this.db, "SELECT COUNT(*) AS n FROM lesson WHERE source = 'taught' AND created_at >= ?", since)?.n ?? 0;
  }

  /** The agent's answer: the line and status (open, none, joined). Only while it still waits on the agent. */
  setWritten(id: number, fields: { text: string; why: string; status: LessonStatus; joinedId: number | null }): void {
    run(
      this.db,
      "UPDATE lesson SET text = ?, why = ?, status = ?, joined_id = ? WHERE id = ? AND status = 'new'",
      fields.text,
      fields.why,
      fields.status,
      fields.joinedId,
      id,
    );
  }

  /** The source review was edited: the candidate starts over from the new text, a joined one too (it may say something else now). */
  restartFromReview(id: number, review: LessonReview): void {
    run(
      this.db,
      `UPDATE lesson SET review_json = ?, text = '', why = '', joined_id = NULL, status = 'new' WHERE id = ? AND ${FOLLOWS_REVIEW}`,
      JSON.stringify(review),
      id,
    );
  }

  /** The same review with replies to bots dropped (`reviewNow` trimmed): the line, its status and its join stay. */
  setReview(id: number, review: LessonReview): void {
    run(this.db, 'UPDATE lesson SET review_json = ? WHERE id = ?', JSON.stringify(review), id);
  }

  setTopic(id: number, topicId: string): void {
    run(this.db, 'UPDATE lesson SET topic_id = ? WHERE id = ?', topicId, id);
  }

  /** The user's decision. Only a pending lesson can be decided; returns false when it was not. */
  decide(id: number, status: LessonStatus, why: string, at: string): boolean {
    return run(this.db, `UPDATE lesson SET status = ?, why = CASE WHEN ? = '' THEN why ELSE ? END, decided_at = ? WHERE id = ? AND ${PENDING}`, status, why, why, at, id) > 0;
  }

  /** Its source is gone: withdrawn, a joined one too, so it stops counting as evidence. */
  withdraw(id: number, why: string, at: string): void {
    run(this.db, `UPDATE lesson SET status = 'withdrawn', why = ?, decided_at = ? WHERE id = ? AND ${FOLLOWS_REVIEW}`, why, at, id);
  }
}

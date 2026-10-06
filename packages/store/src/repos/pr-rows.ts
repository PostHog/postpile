// The child rows of a stored PR (migration 031, DESIGN.md "PR storage"):
// the discussion as `pr_comment`, `pr_thread` and `pr_review` rows. Only
// column mapping lives here; the split and join, with their checks, are
// core's (`splitDiscussion`, `joinDiscussion`).
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { CommentKind, CommentPart, DiscussionParts, ReviewPart, ReviewState, ThreadPart } from '@postpile/core';
import { all, placeholders } from '../sql.ts';

/**
 * `pr.rows_version`: which row model a PR's rows were written with. It is
 * cumulative: version k says every collection up to k is in rows. A build
 * writes the newest it knows on every upsert. Never reuse a number.
 */
export const ROWS = { discussion: 1 } as const;

/** Meta flag (set to when): every stored PR has its discussion rows, so reads take the discussion from them. */
export const DISCUSSION_READY_KEY = 'rows_ready:discussion';

/** SQL: true once reads take the discussion from rows. */
export const DISCUSSION_READY_SQL = `EXISTS (SELECT 1 FROM meta WHERE key = '${DISCUSSION_READY_KEY}')`;

/**
 * SQL over the header `p`: the PR counts as stored. Before the switch any
 * header with its snapshot does; after it, only one whose discussion rows
 * were written. A lower version then is an integrity failure: the PR is
 * left out and the sync fetches it again, like a header without its
 * snapshot.
 */
export const STORED_SQL = `(p.rows_version >= ${ROWS.discussion} OR NOT ${DISCUSSION_READY_SQL})`;

interface CommentRow {
  pr_key: string;
  id: string;
  kind: string;
  ord: number | null;
  author: string;
  created_at: string;
  url: string;
  path: string | null;
  thread_id: string | null;
  thread_ord: number | null;
  review_id: string | null;
  last_edited_at: string | null;
  editor: string | null;
  updated_at: string | null;
  viewer_reacted: number | null;
  /** Null only on a board read: a body no board rule reads (`postpile_reads_body`). */
  body: string | null;
}

interface ThreadRow {
  pr_key: string;
  id: string;
  ord: number;
  path: string;
  is_resolved: number;
}

interface ReviewRow {
  pr_key: string;
  id: string;
  ord: number;
  author: string;
  state: string;
  submitted_at: string;
  commit_oid: string | null;
  viewer_reacted: number | null;
  own_body: string | null;
}

/**
 * Every character JavaScript's `String.prototype.trim` removes (WhiteSpace
 * and LineTerminator in ECMA-262), for SQLite's `trim(X, Y)`, which by
 * default removes spaces only.
 */
export const JS_WHITESPACE = '\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';

/** 0/1, NULL for not recorded. */
function fromMaybeBool(value: boolean | null): number | null {
  return value === null ? null : value ? 1 : 0;
}

function toMaybeBool(value: number | null): boolean | null {
  return value === null ? null : value !== 0;
}

function toCommentPart(row: CommentRow): CommentPart {
  return {
    id: row.id,
    kind: row.kind as CommentKind,
    ord: row.ord,
    author: row.author,
    createdAt: row.created_at,
    url: row.url,
    path: row.path,
    threadId: row.thread_id,
    threadOrd: row.thread_ord,
    reviewId: row.review_id,
    lastEditedAt: row.last_edited_at,
    editor: row.editor,
    updatedAt: row.updated_at,
    viewerReacted: toMaybeBool(row.viewer_reacted),
    body: row.body,
  };
}

function toThreadPart(row: ThreadRow): ThreadPart {
  return { id: row.id, ord: row.ord, path: row.path, isResolved: row.is_resolved !== 0 };
}

function toReviewPart(row: ReviewRow): ReviewPart {
  return {
    id: row.id,
    ord: row.ord,
    author: row.author,
    state: row.state as ReviewState,
    submittedAt: row.submitted_at,
    commitOid: row.commit_oid,
    viewerReacted: toMaybeBool(row.viewer_reacted),
    ownBody: row.own_body,
  };
}

/** The parts of one PR, created on first use. */
function partsOf(byKey: Map<string, DiscussionParts>, key: string): DiscussionParts {
  let parts = byKey.get(key);
  if (parts === undefined) {
    parts = { comments: [], threads: [], reviews: [] };
    byKey.set(key, parts);
  }
  return parts;
}

/**
 * Writes and reads the discussion rows. The write statements are prepared
 * once and reused: a backfill writes ~200k comment rows on a heavy install,
 * and preparing per row (`run()`) would cost more than the inserts.
 */
export class DiscussionRows {
  private statements: { deletes: StatementSync[]; comment: StatementSync; thread: StatementSync; review: StatementSync } | null = null;

  constructor(private readonly db: DatabaseSync) {}

  /** Prepared on first use: the tables exist only once migration 031 ran. */
  private prepared() {
    this.statements ??= {
      deletes: ['pr_comment', 'pr_thread', 'pr_review'].map((table) => this.db.prepare(`DELETE FROM ${table} WHERE pr_key = ?`)),
      comment: this.db.prepare(
        `INSERT INTO pr_comment (pr_key, id, kind, ord, author, created_at, url, path, thread_id, thread_ord, review_id,
           last_edited_at, editor, updated_at, viewer_reacted, body)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      thread: this.db.prepare('INSERT INTO pr_thread (pr_key, id, ord, path, is_resolved) VALUES (?, ?, ?, ?, ?)'),
      review: this.db.prepare(
        `INSERT INTO pr_review (pr_key, id, ord, author, state, submitted_at, commit_oid, viewer_reacted, own_body)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
    };
    return this.statements;
  }

  /** The PR's discussion rows replaced by `parts`. In the caller's transaction, after its header is written. */
  replace(key: string, parts: DiscussionParts): void {
    const statements = this.prepared();
    for (const statement of statements.deletes) {
      statement.run(key);
    }
    for (const c of parts.comments) {
      statements.comment.run(
        key,
        c.id,
        c.kind,
        c.ord,
        c.author,
        c.createdAt,
        c.url,
        c.path,
        c.threadId,
        c.threadOrd,
        c.reviewId,
        c.lastEditedAt,
        c.editor,
        c.updatedAt,
        fromMaybeBool(c.viewerReacted),
        c.body,
      );
    }
    for (const t of parts.threads) {
      statements.thread.run(key, t.id, t.ord, t.path, t.isResolved ? 1 : 0);
    }
    for (const r of parts.reviews) {
      statements.review.run(key, r.id, r.ord, r.author, r.state, r.submittedAt, r.commitOid, fromMaybeBool(r.viewerReacted), r.ownBody);
    }
  }

  /**
   * The rows of these PRs, by key; a PR without any row (no discussion) is
   * missing. In the caller's read transaction. `board`: a comment body no
   * board rule reads stays in SQLite and comes back null (SQL
   * `postpile_reads_body`, registered by PrRepo), so it never becomes a JS
   * string; review bodies the caller handles (`boardReviews`).
   */
  read(keys: string[], board: boolean): Map<string, DiscussionParts> {
    const byKey = new Map<string, DiscussionParts>();
    const list = placeholders(keys.length);
    // An empty or whitespace body stays too (core `boardShape`): trim() with the characters JS's trim() takes off.
    const body = board ? "CASE WHEN postpile_reads_body(author, editor) OR trim(body, ?) = '' THEN body END AS body" : 'body';
    const comments = all<CommentRow>(
      this.db,
      `SELECT pr_key, id, kind, ord, author, created_at, url, path, thread_id, thread_ord, review_id,
         last_edited_at, editor, updated_at, viewer_reacted, ${body}
       FROM pr_comment WHERE pr_key IN (${list})`,
      ...(board ? [JS_WHITESPACE, ...keys] : keys),
    );
    for (const row of comments) {
      partsOf(byKey, row.pr_key).comments.push(toCommentPart(row));
    }
    for (const row of all<ThreadRow>(this.db, `SELECT pr_key, id, ord, path, is_resolved FROM pr_thread WHERE pr_key IN (${list})`, ...keys)) {
      partsOf(byKey, row.pr_key).threads.push(toThreadPart(row));
    }
    const reviews = all<ReviewRow>(
      this.db,
      `SELECT pr_key, id, ord, author, state, submitted_at, commit_oid, viewer_reacted, own_body FROM pr_review WHERE pr_key IN (${list})`,
      ...keys,
    );
    for (const row of reviews) {
      partsOf(byKey, row.pr_key).reviews.push(toReviewPart(row));
    }
    return byKey;
  }
}

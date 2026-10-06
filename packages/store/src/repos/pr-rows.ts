// The rows of a stored PR beside its header (DESIGN.md "PR storage"): the
// discussion as `pr_comment`, `pr_thread` and `pr_review` rows (migration
// 031), the activity lists as `pr_commit`, `pr_timeline` and `pr_file`
// rows (migration 033), the text as header columns and a `pr_body` row
// (migration 034). Only column mapping lives here; the split and join, with
// their checks, are core's (`splitDiscussion` / `joinDiscussion`,
// `splitActivity` / `joinActivity`, `splitText` / `joinText`).
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type {
  ActivityParts,
  CapHit,
  CommentKind,
  CommentPart,
  CommitPart,
  DiscussionParts,
  FilePart,
  OptionalHeaderField,
  ReviewDecision,
  ReviewPart,
  ReviewState,
  ThreadPart,
  TimelineItemKind,
  TextPart,
  TimelinePart,
} from '@postpile/core';
import { all, placeholders } from '../sql.ts';

/**
 * `pr.rows_version`: which row model a PR's rows were written with. It is
 * cumulative: version k says every collection up to k is in rows. A build
 * writes the newest it knows on every upsert, and a backfill raises a PR
 * by one step only. Never reuse a number.
 */
export const ROWS = { discussion: 1, activity: 2, text: 3 } as const;

/** The rows_version every upsert of this build writes: every collection it knows is in rows. */
export const NEWEST_ROWS_VERSION = ROWS.text;

/** A part of a PR that moves into rows on its own, with its own readiness flag. */
export type RowsCollection = keyof typeof ROWS;

/** Meta flag (set to when): every stored PR has its discussion rows, so reads take the discussion from them. */
export const DISCUSSION_READY_KEY = 'rows_ready:discussion';

/** Meta flag (set to when): every stored PR has its activity rows (commits, timeline, files). */
export const ACTIVITY_READY_KEY = 'rows_ready:activity';

/** Meta flag (set to when): every stored PR has its text columns and body row; from then on no read takes the snapshot json. */
export const TEXT_READY_KEY = 'rows_ready:text';

/** Each collection's readiness flag. */
export const READY_KEYS: Record<RowsCollection, string> = { discussion: DISCUSSION_READY_KEY, activity: ACTIVITY_READY_KEY, text: TEXT_READY_KEY };

/** The lowest rows_version a stored PR needs once these collections are read from rows (cumulative: the highest of them). */
export function storedRowsVersion(ready: ReadonlySet<RowsCollection>): number {
  let version = 0;
  for (const collection of ready) {
    version = Math.max(version, ROWS[collection]);
  }
  return version;
}

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
  url: string | null;
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
    url: row.url,
    ownBody: row.own_body,
  };
}

/** The discussion parts of one PR, created on first use. */
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
        `INSERT INTO pr_review (pr_key, id, ord, author, state, submitted_at, commit_oid, viewer_reacted, url, own_body)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      statements.review.run(key, r.id, r.ord, r.author, r.state, r.submittedAt, r.commitOid, fromMaybeBool(r.viewerReacted), r.url, r.ownBody);
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
      `SELECT pr_key, id, ord, author, state, submitted_at, commit_oid, viewer_reacted, url, own_body FROM pr_review WHERE pr_key IN (${list})`,
      ...keys,
    );
    for (const row of reviews) {
      partsOf(byKey, row.pr_key).reviews.push(toReviewPart(row));
    }
    return byKey;
  }
}

interface CommitRow {
  pr_key: string;
  oid: string;
  ord: number;
  headline: string;
  author: string;
  committer: string | null;
  committed_at: string;
}

interface TimelineRow {
  pr_key: string;
  id: string;
  ord: number;
  kind: string;
  actor: string;
  at: string;
  subject: string | null;
}

interface FileRow {
  pr_key: string;
  path: string;
  ord: number;
  additions: number;
  deletions: number;
}

/** The activity parts of one PR, created on first use. */
function activityOf(byKey: Map<string, ActivityParts>, key: string): ActivityParts {
  let parts = byKey.get(key);
  if (parts === undefined) {
    parts = { commits: [], timeline: [], files: [] };
    byKey.set(key, parts);
  }
  return parts;
}

/** Writes and reads the activity rows, with the write statements prepared once (like DiscussionRows). */
export class ActivityRows {
  private statements: { deletes: StatementSync[]; commit: StatementSync; timeline: StatementSync; file: StatementSync } | null = null;

  constructor(private readonly db: DatabaseSync) {}

  /** Prepared on first use: the tables exist only once migration 033 ran. */
  private prepared() {
    this.statements ??= {
      deletes: ['pr_commit', 'pr_timeline', 'pr_file'].map((table) => this.db.prepare(`DELETE FROM ${table} WHERE pr_key = ?`)),
      commit: this.db.prepare('INSERT INTO pr_commit (pr_key, oid, ord, headline, author, committer, committed_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      timeline: this.db.prepare('INSERT INTO pr_timeline (pr_key, id, ord, kind, actor, at, subject) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      file: this.db.prepare('INSERT INTO pr_file (pr_key, path, ord, additions, deletions) VALUES (?, ?, ?, ?, ?)'),
    };
    return this.statements;
  }

  /** The PR's activity rows replaced by `parts`. In the caller's transaction, after its header is written. */
  replace(key: string, parts: ActivityParts): void {
    const statements = this.prepared();
    for (const statement of statements.deletes) {
      statement.run(key);
    }
    for (const c of parts.commits) {
      statements.commit.run(key, c.oid, c.ord, c.headline, c.author, c.committer, c.committedAt);
    }
    for (const t of parts.timeline) {
      statements.timeline.run(key, t.id, t.ord, t.kind, t.actor, t.at, t.subject);
    }
    for (const f of parts.files) {
      statements.file.run(key, f.path, f.ord, f.additions, f.deletions);
    }
  }

  /** The rows of these PRs, by key; a PR without any row (no commit, item or file) is missing. In the caller's read transaction. */
  read(keys: string[]): Map<string, ActivityParts> {
    const byKey = new Map<string, ActivityParts>();
    const list = placeholders(keys.length);
    for (const row of all<CommitRow>(this.db, `SELECT pr_key, oid, ord, headline, author, committer, committed_at FROM pr_commit WHERE pr_key IN (${list})`, ...keys)) {
      const commit: CommitPart = { oid: row.oid, ord: row.ord, headline: row.headline, author: row.author, committer: row.committer, committedAt: row.committed_at };
      activityOf(byKey, row.pr_key).commits.push(commit);
    }
    for (const row of all<TimelineRow>(this.db, `SELECT pr_key, id, ord, kind, actor, at, subject FROM pr_timeline WHERE pr_key IN (${list})`, ...keys)) {
      const item: TimelinePart = { id: row.id, ord: row.ord, kind: row.kind as TimelineItemKind, actor: row.actor, at: row.at, subject: row.subject };
      activityOf(byKey, row.pr_key).timeline.push(item);
    }
    for (const row of all<FileRow>(this.db, `SELECT pr_key, path, ord, additions, deletions FROM pr_file WHERE pr_key IN (${list})`, ...keys)) {
      const file: FilePart = { path: row.path, ord: row.ord, additions: row.additions, deletions: row.deletions };
      activityOf(byKey, row.pr_key).files.push(file);
    }
    return byKey;
  }
}

/** The text columns of a `pr` row and its `pr_body` row, as a read selects them. */
export interface TextRow {
  url: string;
  body: string;
  additions: number;
  deletions: number;
  changed_files: number;
  labels: string;
  review_decision: string;
  merged_by: string | null;
  truncated: number | null;
  cap_hits: string | null;
  absent_fields: string;
}

/** SQL: the columns of `TextRow`, over the header `p` and its body row `b`. */
export const TEXT_COLUMNS_SQL =
  'p.url, b.body, p.additions, p.deletions, p.changed_files, p.labels, p.review_decision, p.merged_by, p.truncated, p.cap_hits, p.absent_fields';

export function toTextPart(row: TextRow): TextPart {
  return {
    url: row.url,
    body: row.body,
    additions: row.additions,
    deletions: row.deletions,
    changedFiles: row.changed_files,
    labels: row.labels === '[]' ? [] : (JSON.parse(row.labels) as string[]),
    reviewDecision: row.review_decision as ReviewDecision,
    mergedBy: row.merged_by,
    truncated: toMaybeBool(row.truncated),
    capHits: row.cap_hits === null ? null : (JSON.parse(row.cap_hits) as CapHit[]),
    absentFields: row.absent_fields === '[]' ? [] : (JSON.parse(row.absent_fields) as OptionalHeaderField[]),
  };
}

/** Writes the text rows: the header's text columns and the body row, with the statements prepared once. */
export class TextRows {
  private statements: { header: StatementSync; body: StatementSync } | null = null;

  constructor(private readonly db: DatabaseSync) {}

  /** Prepared on first use: the columns and table exist only once migration 034 ran. */
  private prepared() {
    this.statements ??= {
      header: this.db.prepare(
        `UPDATE pr SET url = ?, additions = ?, deletions = ?, changed_files = ?, labels = ?, review_decision = ?, merged_by = ?,
           truncated = ?, cap_hits = ?, absent_fields = ?
         WHERE key = ?`,
      ),
      body: this.db.prepare('INSERT INTO pr_body (pr_key, body) VALUES (?, ?) ON CONFLICT (pr_key) DO UPDATE SET body = excluded.body'),
    };
    return this.statements;
  }

  /** The PR's text rows replaced by `text`. In the caller's transaction, after its header is written. */
  replace(key: string, text: TextPart): void {
    const statements = this.prepared();
    statements.header.run(
      text.url,
      text.additions,
      text.deletions,
      text.changedFiles,
      JSON.stringify(text.labels),
      text.reviewDecision,
      text.mergedBy,
      fromMaybeBool(text.truncated),
      text.capHits === null ? null : JSON.stringify(text.capHits),
      JSON.stringify(text.absentFields),
      key,
    );
    statements.body.run(key, text.body);
  }
}

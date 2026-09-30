import type { DatabaseSync } from 'node:sqlite';
import { prKey, type NotificationReason, type NotificationThread, type PrKey } from '@postpile/core';
import { inTransaction } from '../database.ts';
import { all, fromBool, one, placeholders, run, toBool } from '../sql.ts';

interface ThreadRow {
  id: string;
  pr_key: string | null;
  reason: string;
  unread: number;
  updated_at: string;
  last_read_at: string | null;
  subject_type: string;
  repo: string;
  number: number | null;
  title: string;
}

function toThread(row: ThreadRow): NotificationThread {
  return {
    id: row.id,
    reason: row.reason as NotificationReason,
    unread: toBool(row.unread),
    updatedAt: row.updated_at,
    lastReadAt: row.last_read_at,
    subjectType: row.subject_type,
    repo: row.repo,
    number: row.number,
    title: row.title,
  };
}

/** Only pull request threads map to a PR. */
function prKeyFor(thread: NotificationThread): PrKey | null {
  if (thread.subjectType !== 'PullRequest' || thread.number === null) {
    return null;
  }
  return prKey({ repo: thread.repo, number: thread.number });
}

export class NotificationRepo {
  constructor(private readonly db: DatabaseSync) {}

  upsertMany(threads: NotificationThread[]): void {
    inTransaction(this.db, () => {
      for (const thread of threads) {
        run(
          this.db,
          `INSERT INTO notification_thread
             (id, pr_key, reason, unread, updated_at, last_read_at, subject_type, repo, number, title)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET
             pr_key = excluded.pr_key, reason = excluded.reason, unread = excluded.unread,
             updated_at = excluded.updated_at, last_read_at = excluded.last_read_at,
             subject_type = excluded.subject_type, repo = excluded.repo, number = excluded.number,
             title = excluded.title`,
          thread.id,
          prKeyFor(thread),
          thread.reason,
          fromBool(thread.unread),
          thread.updatedAt,
          thread.lastReadAt,
          thread.subjectType,
          thread.repo,
          thread.number,
          thread.title,
        );
      }
    });
  }

  /** Newest first. */
  list(): NotificationThread[] {
    return all<ThreadRow>(this.db, 'SELECT * FROM notification_thread ORDER BY updated_at DESC, id').map(toThread);
  }

  get(threadId: string): NotificationThread | null {
    const row = one<ThreadRow>(this.db, 'SELECT * FROM notification_thread WHERE id = ?', threadId);
    return row ? toThread(row) : null;
  }

  /** GitHub keeps one thread per PR; if there are several, the newest wins. */
  getByPrKey(key: PrKey): NotificationThread | null {
    const row = one<ThreadRow>(
      this.db,
      'SELECT * FROM notification_thread WHERE pr_key = ? ORDER BY updated_at DESC LIMIT 1',
      key,
    );
    return row ? toThread(row) : null;
  }

  getByPrKeys(keys: PrKey[]): Map<PrKey, NotificationThread> {
    const result = new Map<PrKey, NotificationThread>();
    if (keys.length === 0) {
      return result;
    }
    const rows = all<ThreadRow>(
      this.db,
      `SELECT * FROM notification_thread WHERE pr_key IN (${placeholders(keys.length)}) ORDER BY updated_at`,
      ...keys,
    );
    // Ordered oldest first, so the newest thread per PR is written last.
    for (const row of rows) {
      result.set(row.pr_key as PrKey, toThread(row));
    }
    return result;
  }

  /** Local mirror of a mark-read that was actually sent to GitHub. */
  markRead(threadId: string, at: string): void {
    run(this.db, 'UPDATE notification_thread SET unread = 0, last_read_at = ? WHERE id = ?', at, threadId);
  }

  /** Puts a thread back to unread with the read time it had: an undo, or a mark-read GitHub did not take. */
  markUnread(threadId: string, lastReadAt: string | null): void {
    run(this.db, 'UPDATE notification_thread SET unread = 1, last_read_at = ? WHERE id = ?', lastReadAt, threadId);
  }
}

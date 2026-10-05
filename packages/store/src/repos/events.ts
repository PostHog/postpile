import type { DatabaseSync } from 'node:sqlite';
import type { EventKind, Loudness, LoudnessOverride, PrEvent, PrKey } from '@postpile/core';
import { inTransaction } from '../database.ts';
import { all, each, fromBool, placeholders, run, toBool } from '../sql.ts';

export interface EventRow {
  id: string;
  pr_key: string;
  kind: string;
  actor: string;
  is_bot: number;
  at: string;
  summary: string;
  url: string | null;
  source_id: string;
  rule_loudness: string;
  rule_reason: string;
  override_loudness: string | null;
  override_reason: string | null;
  override_by: string | null;
  seen_at: string | null;
}

function toOverride(row: EventRow): LoudnessOverride | null {
  if (row.override_loudness === null) {
    return null;
  }
  return {
    loudness: row.override_loudness as Loudness,
    reason: row.override_reason ?? '',
    by: row.override_by === 'user' ? 'user' : 'agent',
  };
}

export function toEvent(row: EventRow): PrEvent {
  return {
    id: row.id,
    prKey: row.pr_key,
    kind: row.kind as EventKind,
    actor: row.actor,
    isBot: toBool(row.is_bot),
    at: row.at,
    summary: row.summary,
    url: row.url,
    sourceId: row.source_id,
    ruleLoudness: row.rule_loudness as Loudness,
    ruleReason: row.rule_reason,
    override: toOverride(row),
    seenAt: row.seen_at,
  };
}

/** Events PostPile makes itself, never derived from a GitHub snapshot: a snapshot store keeps them. */
export const APP_EVENT_KINDS: readonly EventKind[] = ['look_closer'];

/** Ids per query in `storedIds`: a cleanup's batch can hold thousands. */
const STORED_IDS_CHUNK = 500;

/**
 * The two kinds a machine comment's event takes, by whether the kept part
 * of its body says "deploy" (core `commentEvent`). Its id changes with the
 * kind, but it stays the same event.
 */
const MACHINE_COMMENT_KINDS: readonly EventKind[] = ['deploy', 'bot_comment'];

interface StoredId {
  id: string;
  kind: string;
  source_id: string;
}

/**
 * The derived event that continues a stored one under a new id: the same
 * machine comment, now the other of its two kinds. A body cut on save no
 * longer says "deploy" in the part kept (DESIGN.md "Bot bodies are cut
 * when saved"), or a bot's edit made it say so. Any other kind change is a
 * new event: a comment that now mentions the viewer is news.
 */
function successorOf(stored: StoredId, events: PrEvent[], existing: Set<string>): PrEvent | null {
  if (!MACHINE_COMMENT_KINDS.includes(stored.kind as EventKind)) {
    return null;
  }
  return (
    events.find((event) => event.sourceId === stored.source_id && event.kind !== stored.kind && MACHINE_COMMENT_KINDS.includes(event.kind) && !existing.has(event.id)) ??
    null
  );
}

export class EventRepo {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * Gives a stored event a new id and keeps everything else on its row
   * (seen_at, override_*). Its event log entry follows, so it keeps its
   * first sighting. When both ids were logged (the comment had this kind
   * before), the earlier sighting stays and the later row goes.
   */
  private rename(oldId: string, newId: string): void {
    run(this.db, 'UPDATE pr_event SET id = ? WHERE id = ?', newId, oldId);
    const logged = all<{ seq: number; event_id: string }>(this.db, 'SELECT seq, event_id FROM event_log WHERE event_id IN (?, ?) ORDER BY seq', oldId, newId);
    const [first, ...later] = logged;
    if (first === undefined) {
      return;
    }
    for (const row of later) {
      run(this.db, 'DELETE FROM event_log WHERE seq = ?', row.seq);
    }
    if (first.event_id !== newId) {
      run(this.db, 'UPDATE event_log SET event_id = ? WHERE seq = ?', newId, first.seq);
    }
  }

  /**
   * Writes freshly derived events for one PR. Keeps seen_at and override_* of
   * events that already exist, and drops events the new snapshot no longer
   * produces (deleted comments, a kind that changed). A machine comment
   * that changed between deploy and bot_comment is renamed instead
   * (`successorOf`, `rename`): it keeps its seen time, override and event
   * log seq. App-made events (`APP_EVENT_KINDS`, see `addAppEvent`) are not
   * derived and stay. Returns the new ids; a renamed one is not new.
   */
  upsertDerived(prKey: PrKey, events: PrEvent[]): string[] {
    return inTransaction(this.db, () => {
      const stored = all<StoredId>(this.db, 'SELECT id, kind, source_id FROM pr_event WHERE pr_key = ?', prKey).filter(
        (row) => !APP_EVENT_KINDS.includes(row.kind as EventKind),
      );
      const existing = new Set(stored.map((row) => row.id));
      const incoming = new Set(events.map((event) => event.id));
      for (const row of stored) {
        if (incoming.has(row.id)) {
          continue;
        }
        const successor = successorOf(row, events, existing);
        if (successor === null) {
          run(this.db, 'DELETE FROM pr_event WHERE id = ?', row.id);
        } else {
          this.rename(row.id, successor.id);
          existing.add(successor.id);
        }
      }
      const created: string[] = [];
      for (const event of events) {
        run(
          this.db,
          `INSERT INTO pr_event
             (id, pr_key, kind, actor, is_bot, at, summary, url, source_id, rule_loudness, rule_reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET
             kind = excluded.kind, actor = excluded.actor, is_bot = excluded.is_bot, at = excluded.at,
             summary = excluded.summary, url = excluded.url, source_id = excluded.source_id,
             rule_loudness = excluded.rule_loudness, rule_reason = excluded.rule_reason`,
          event.id,
          prKey,
          event.kind,
          event.actor,
          fromBool(event.isBot),
          event.at,
          event.summary,
          event.url,
          event.sourceId,
          event.ruleLoudness,
          event.ruleReason,
        );
        if (!existing.has(event.id)) {
          created.push(event.id);
        }
      }
      return created;
    });
  }

  /**
   * An event PostPile makes itself (a Look closer ping on a routed review).
   * Inserted once; an existing id is left as it is (seen stays seen).
   * Returns whether it was new.
   */
  addAppEvent(event: PrEvent): boolean {
    const changes = run(
      this.db,
      `INSERT OR IGNORE INTO pr_event
         (id, pr_key, kind, actor, is_bot, at, summary, url, source_id, rule_loudness, rule_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      event.id,
      event.prKey,
      event.kind,
      event.actor,
      fromBool(event.isBot),
      event.at,
      event.summary,
      event.url,
      event.sourceId,
      event.ruleLoudness,
      event.ruleReason,
    );
    return changes > 0;
  }

  /** Oldest first. */
  listForPr(prKey: PrKey): PrEvent[] {
    return all<EventRow>(this.db, 'SELECT * FROM pr_event WHERE pr_key = ? ORDER BY at, id', prKey).map(toEvent);
  }

  /** Oldest first per PR. Every requested key is present, possibly with an empty list. */
  listForPrs(prKeys: PrKey[]): Map<PrKey, PrEvent[]> {
    const result = new Map<PrKey, PrEvent[]>(prKeys.map((key) => [key, []]));
    if (prKeys.length === 0) {
      return result;
    }
    const rows = each<EventRow>(
      this.db,
      // pr_key first so the rows come straight from the (pr_key, at, id) index, no sort.
      `SELECT * FROM pr_event WHERE pr_key IN (${placeholders(prKeys.length)}) ORDER BY pr_key, at, id`,
      ...prKeys,
    );
    for (const row of rows) {
      result.get(row.pr_key)?.push(toEvent(row));
    }
    return result;
  }

  /**
   * PRs with an event aimed at the viewer in person: a mention, a reply or
   * question to them, the author answering their changes request. The hot
   * tier "you" reads it. Review requests are left out: their rule reason
   * says "from you" for a request to one of the viewer's teams as well, and
   * a pending personal request is in the PR header's reviewers. The WHERE
   * must stay the predicate of the partial index from migration 028 word for
   * word, or SQLite scans every event (1.5 s on 485k events).
   */
  prKeysWithPersonalAsks(): Set<PrKey> {
    const rows = all<{ pr_key: string }>(
      this.db,
      `SELECT DISTINCT pr_key FROM pr_event
       WHERE kind IN ('mention', 'reply_to_user', 'question_to_user') OR rule_reason = 'addressed your changes'`,
    );
    return new Set(rows.map((row) => row.pr_key));
  }

  /** Which of these ids are stored now. */
  storedIds(ids: string[]): Set<string> {
    const stored = new Set<string>();
    for (let start = 0; start < ids.length; start += STORED_IDS_CHUNK) {
      const chunk = ids.slice(start, start + STORED_IDS_CHUNK);
      for (const row of all<{ id: string }>(this.db, `SELECT id FROM pr_event WHERE id IN (${placeholders(chunk.length)})`, ...chunk)) {
        stored.add(row.id);
      }
    }
    return stored;
  }

  /** Leaves events that were already seen alone, so the first seen time sticks. */
  markSeen(eventIds: string[], at: string): void {
    if (eventIds.length === 0) {
      return;
    }
    run(
      this.db,
      `UPDATE pr_event SET seen_at = ? WHERE seen_at IS NULL AND id IN (${placeholders(eventIds.length)})`,
      at,
      ...eventIds,
    );
  }

  /** Undo of a mark-read inside the undo window. */
  clearSeen(eventIds: string[]): void {
    if (eventIds.length === 0) {
      return;
    }
    run(this.db, `UPDATE pr_event SET seen_at = NULL WHERE id IN (${placeholders(eventIds.length)})`, ...eventIds);
  }

  setOverride(eventId: string, override: LoudnessOverride | null): void {
    run(
      this.db,
      'UPDATE pr_event SET override_loudness = ?, override_reason = ?, override_by = ? WHERE id = ?',
      override?.loudness ?? null,
      override?.reason ?? null,
      override?.by ?? null,
      eventId,
    );
  }
}

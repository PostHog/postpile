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

export class EventRepo {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * Writes freshly derived events for one PR. Keeps seen_at and override_* of
   * events that already exist, and drops events the new snapshot no longer
   * produces (deleted comments, a kind that changed). App-made events
   * (`APP_EVENT_KINDS`, see `addAppEvent`) are not derived and stay. Returns
   * the new ids.
   */
  upsertDerived(prKey: PrKey, events: PrEvent[]): string[] {
    return inTransaction(this.db, () => {
      const existing = new Set(
        all<{ id: string; kind: string }>(this.db, 'SELECT id, kind FROM pr_event WHERE pr_key = ?', prKey)
          .filter((row) => !APP_EVENT_KINDS.includes(row.kind as EventKind))
          .map((row) => row.id),
      );
      const incoming = new Set(events.map((event) => event.id));
      for (const id of existing) {
        if (!incoming.has(id)) {
          run(this.db, 'DELETE FROM pr_event WHERE id = ?', id);
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
   * question to them, a review requested from them (answered or not), the
   * author answering their changes request. The hot tier "you" reads it.
   * The WHERE must stay the predicate of the partial index from migration
   * 028 word for word, or SQLite scans every event (1.5 s on 485k events).
   */
  prKeysWithPersonalAsks(): Set<PrKey> {
    const rows = all<{ pr_key: string }>(
      this.db,
      `SELECT DISTINCT pr_key FROM pr_event
       WHERE kind IN ('mention', 'reply_to_user', 'question_to_user')
          OR rule_reason IN ('review requested from you', 'review request already answered or removed', 'addressed your changes')`,
    );
    return new Set(rows.map((row) => row.pr_key));
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

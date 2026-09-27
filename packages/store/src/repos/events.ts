import type { DatabaseSync } from 'node:sqlite';
import type { EventKind, Loudness, LoudnessOverride, PrEvent, PrKey } from '@code-manager/core';
import { inTransaction } from '../database.ts';
import { all, fromBool, placeholders, run, toBool } from '../sql.ts';

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

export class EventRepo {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * Writes freshly derived events for one PR. Keeps seen_at and override_* of
   * events that already exist, and drops events the new snapshot no longer
   * produces (deleted comments, a kind that changed). Returns the new ids.
   */
  upsertDerived(prKey: PrKey, events: PrEvent[]): string[] {
    return inTransaction(this.db, () => {
      const existing = new Set(
        all<{ id: string }>(this.db, 'SELECT id FROM pr_event WHERE pr_key = ?', prKey).map((row) => row.id),
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
    const rows = all<EventRow>(
      this.db,
      `SELECT * FROM pr_event WHERE pr_key IN (${placeholders(prKeys.length)}) ORDER BY at, id`,
      ...prKeys,
    );
    for (const row of rows) {
      result.get(row.pr_key)?.push(toEvent(row));
    }
    return result;
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

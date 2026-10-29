import type { DatabaseSync } from 'node:sqlite';
import type { IsoTime, PrKey, ScoutedPr, ScoutExpiryReason } from '@postpile/core';
import { all, one, placeholders, run } from '../sql.ts';

interface ScoutedPrRow {
  pr_key: string;
  scout_id: string;
  scout_name: string;
  config_version: number;
  reason: string;
  pulled_at: string;
  seen_updated_at: string | null;
  followed_at: string | null;
  dismissed_at: string | null;
  dismiss_reason: string | null;
  expired_at: string | null;
  expiry_reason: string | null;
}

function toScouted(row: ScoutedPrRow): ScoutedPr {
  return {
    prKey: row.pr_key,
    scoutId: row.scout_id,
    scoutName: row.scout_name,
    configVersion: row.config_version,
    reason: row.reason,
    pulledAt: row.pulled_at,
    seenUpdatedAt: row.seen_updated_at,
    followedAt: row.followed_at,
    dismissedAt: row.dismissed_at,
    dismissReason: row.dismiss_reason,
    expiredAt: row.expired_at,
    expiryReason: row.expiry_reason as ScoutExpiryReason | null,
  };
}

const ACTIVE = 'followed_at IS NULL AND dismissed_at IS NULL AND expired_at IS NULL';

/** PRs scouts pulled in, one row per PR, kept as history after a follow, dismiss or expiry (DESIGN.md "Scouts"). */
export class ScoutedPrRepo {
  constructor(private readonly db: DatabaseSync) {}

  get(prKey: PrKey): ScoutedPr | null {
    const row = one<ScoutedPrRow>(this.db, 'SELECT * FROM pr_scouted WHERE pr_key = ?', prKey);
    return row ? toScouted(row) : null;
  }

  getMany(prKeys: PrKey[]): Map<PrKey, ScoutedPr> {
    if (prKeys.length === 0) {
      return new Map();
    }
    const rows = all<ScoutedPrRow>(this.db, `SELECT * FROM pr_scouted WHERE pr_key IN (${placeholders(prKeys.length)})`, ...prKeys);
    return new Map(rows.map((row) => [row.pr_key, toScouted(row)]));
  }

  /** Every row, history included. */
  listAll(): ScoutedPr[] {
    return all<ScoutedPrRow>(this.db, 'SELECT * FROM pr_scouted ORDER BY pulled_at, pr_key').map(toScouted);
  }

  /** Still on the board: not followed, dismissed or expired. */
  listActive(): ScoutedPr[] {
    return all<ScoutedPrRow>(this.db, `SELECT * FROM pr_scouted WHERE ${ACTIVE} ORDER BY pulled_at, pr_key`).map(toScouted);
  }

  /** Followed through a scout: PostPile tracks these normally from then on. */
  followedKeys(): Set<PrKey> {
    return new Set(all<{ pr_key: string }>(this.db, 'SELECT pr_key FROM pr_scouted WHERE followed_at IS NOT NULL').map((row) => row.pr_key));
  }

  /**
   * The Scouted section's rows, from headers only (no snapshot read): active
   * PRs PostPile does not track otherwise (no notification thread, not
   * found by the sync, in no topic, not a stack layer a tracked PR pulled
   * in), each with whether it is unseen (never seen, or GitHub activity
   * after the update it was seen through). The caller drops layers of
   * stacks a tracked PR shows (`ReadModels.listScouts`).
   */
  listUntracked(): { prKey: PrKey; scoutId: string; unseen: boolean }[] {
    const rows = all<{ pr_key: string; scout_id: string; unseen: number }>(
      this.db,
      `SELECT s.pr_key AS pr_key, s.scout_id AS scout_id,
              CASE WHEN s.seen_updated_at IS NULL OR s.seen_updated_at < p.updated_at THEN 1 ELSE 0 END AS unseen
       FROM pr_scouted s JOIN pr p ON p.key = s.pr_key
       WHERE s.followed_at IS NULL AND s.dismissed_at IS NULL AND s.expired_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM notification_thread t WHERE t.pr_key = s.pr_key)
         AND NOT EXISTS (SELECT 1 FROM pr_found f WHERE f.pr_key = s.pr_key)
         AND NOT EXISTS (SELECT 1 FROM topic_membership m WHERE m.pr_key = s.pr_key)
       ORDER BY s.pr_key`,
    );
    return rows.map((row) => ({ prKey: row.pr_key, scoutId: row.scout_id, unseen: row.unseen === 1 }));
  }

  /** First scout wins: a PR another scout already pulled keeps its row. True when this one was stored. */
  insert(scouted: ScoutedPr): boolean {
    const changed = run(
      this.db,
      `INSERT OR IGNORE INTO pr_scouted (pr_key, scout_id, scout_name, config_version, reason, pulled_at, seen_updated_at, followed_at, dismissed_at, dismiss_reason, expired_at, expiry_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      scouted.prKey,
      scouted.scoutId,
      scouted.scoutName,
      scouted.configVersion,
      scouted.reason,
      scouted.pulledAt,
      scouted.seenUpdatedAt,
      scouted.followedAt,
      scouted.dismissedAt,
      scouted.dismissReason,
      scouted.expiredAt,
      scouted.expiryReason,
    );
    return changed > 0;
  }

  /** Local seen, never a GitHub read: seen through this PR updatedAt. Never moves back. */
  markSeen(prKey: PrKey, updatedAt: IsoTime): boolean {
    const changed = run(
      this.db,
      'UPDATE pr_scouted SET seen_updated_at = ? WHERE pr_key = ? AND (seen_updated_at IS NULL OR seen_updated_at < ?)',
      updatedAt,
      prKey,
      updatedAt,
    );
    return changed > 0;
  }

  /** Only after GitHub took the subscription. */
  markFollowed(prKey: PrKey, at: IsoTime): boolean {
    return run(this.db, 'UPDATE pr_scouted SET followed_at = ? WHERE pr_key = ? AND followed_at IS NULL', at, prKey) > 0;
  }

  dismiss(prKey: PrKey, at: IsoTime, reason: string | null): boolean {
    return run(this.db, `UPDATE pr_scouted SET dismissed_at = ?, dismiss_reason = ? WHERE pr_key = ? AND ${ACTIVE}`, at, reason, prKey) > 0;
  }

  expire(prKey: PrKey, at: IsoTime, reason: ScoutExpiryReason): boolean {
    return run(this.db, `UPDATE pr_scouted SET expired_at = ?, expiry_reason = ? WHERE pr_key = ? AND ${ACTIVE}`, at, reason, prKey) > 0;
  }
}

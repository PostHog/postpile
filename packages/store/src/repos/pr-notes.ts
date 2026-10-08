import type { DatabaseSync } from 'node:sqlite';
import type { NoteAnchor, PrKey, PrNote, PrNoteKind, PrNoteSlot } from '@postpile/core';
import { all, insertReturningId, one, placeholders, run } from '../sql.ts';

interface PrNoteRow {
  seq: number;
  id: string;
  pr_key: string;
  slot: string;
  kind: string;
  by: string;
  client: string;
  note: string;
  covered_by_pr_key: string | null;
  anchor: string;
  cover_anchor: string | null;
  created_at: string;
  expires_at: string | null;
  cleared_at: string | null;
  cleared_by: string | null;
  superseded_by: string | null;
  idempotency_key: string | null;
}

function toNote(row: PrNoteRow): PrNote {
  return {
    seq: row.seq,
    id: row.id,
    prKey: row.pr_key,
    slot: row.slot as PrNoteSlot,
    kind: row.kind as PrNoteKind,
    by: row.by,
    client: row.client,
    note: row.note,
    coveredByPrKey: row.covered_by_pr_key,
    anchor: JSON.parse(row.anchor) as NoteAnchor,
    coverAnchor: row.cover_anchor === null ? null : (JSON.parse(row.cover_anchor) as NoteAnchor),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    clearedAt: row.cleared_at,
    clearedBy: row.cleared_by,
    supersededBy: row.superseded_by,
    idempotencyKey: row.idempotency_key,
  };
}

const CURRENT = 'cleared_at IS NULL AND superseded_by IS NULL';

/** Agent notes on PRs (DESIGN.md "Agent notes on PRs"). The checks live in core (`planNoteSet`); this only stores. */
export class PrNoteRepo {
  constructor(private readonly db: DatabaseSync) {}

  /** Returns the new row's seq. */
  insert(note: Omit<PrNote, 'seq'>): number {
    return insertReturningId(
      this.db,
      `INSERT INTO pr_note
         (id, pr_key, slot, kind, by, client, note, covered_by_pr_key, anchor, cover_anchor, created_at, expires_at, cleared_at, cleared_by, superseded_by, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      note.id,
      note.prKey,
      note.slot,
      note.kind,
      note.by,
      note.client,
      note.note,
      note.coveredByPrKey,
      JSON.stringify(note.anchor),
      note.coverAnchor === null ? null : JSON.stringify(note.coverAnchor),
      note.createdAt,
      note.expiresAt,
      note.clearedAt,
      note.clearedBy,
      note.supersededBy,
      note.idempotencyKey,
    );
  }

  get(id: string): PrNote | null {
    const row = one<PrNoteRow>(this.db, 'SELECT * FROM pr_note WHERE id = ?', id);
    return row ? toNote(row) : null;
  }

  getByIdempotencyKey(key: string): PrNote | null {
    const row = one<PrNoteRow>(this.db, 'SELECT * FROM pr_note WHERE idempotency_key = ?', key);
    return row ? toNote(row) : null;
  }

  /** The current note in a PR's slot (not cleared, not replaced), stale or expired or not. */
  currentIn(prKey: PrKey, slot: PrNoteSlot): PrNote | null {
    const row = one<PrNoteRow>(this.db, `SELECT * FROM pr_note WHERE pr_key = ? AND slot = ? AND ${CURRENT} ORDER BY seq DESC LIMIT 1`, prKey, slot);
    return row ? toNote(row) : null;
  }

  /**
   * One query for many PRs: each PR's current notes plus its newest
   * replaced one (pr_context's "replaced ..."), oldest first.
   */
  listForPrs(prKeys: PrKey[]): PrNote[] {
    if (prKeys.length === 0) {
      return [];
    }
    const marks = placeholders(prKeys.length);
    return all<PrNoteRow>(
      this.db,
      `SELECT * FROM pr_note
       WHERE pr_key IN (${marks})
         AND ((${CURRENT}) OR seq IN (SELECT MAX(seq) FROM pr_note WHERE pr_key IN (${marks}) AND superseded_by IS NOT NULL GROUP BY pr_key))
       ORDER BY seq`,
      ...prKeys,
      ...prKeys,
    ).map(toNote);
  }

  /** Each current covered note's PR and covering PR: the sync keeps the covering PRs fresh, so these notes go stale when they move. */
  listCurrentCovers(): { prKey: PrKey; coveredByPrKey: PrKey }[] {
    const rows = all<{ pr_key: string; covered_by_pr_key: string }>(
      this.db,
      `SELECT DISTINCT pr_key, covered_by_pr_key FROM pr_note WHERE covered_by_pr_key IS NOT NULL AND ${CURRENT} ORDER BY pr_key`,
    );
    return rows.map((row) => ({ prKey: row.pr_key, coveredByPrKey: row.covered_by_pr_key }));
  }

  /** Current notes whose lease has not run out, on open PRs: for the caps. `client` counts one client's only. */
  countLiveOnOpenPrs(now: string, client?: string): number {
    const byClient = client === undefined ? '' : ' AND n.client = ?';
    const params = client === undefined ? [now] : [now, client];
    const row = one<{ count: number }>(
      this.db,
      `SELECT COUNT(*) AS count FROM pr_note n JOIN pr p ON p.key = n.pr_key
       WHERE n.cleared_at IS NULL AND n.superseded_by IS NULL AND (n.expires_at IS NULL OR n.expires_at > ?) AND p.state = 'OPEN'${byClient}`,
      ...params,
    );
    return row?.count ?? 0;
  }

  supersede(id: string, byId: string): void {
    run(this.db, 'UPDATE pr_note SET superseded_by = ?, idempotency_key = NULL WHERE id = ?', byId, id);
  }

  /** Frees the idempotency key of a note that is no longer current, so the same request can write a new one. */
  releaseKey(id: string): void {
    run(this.db, 'UPDATE pr_note SET idempotency_key = NULL WHERE id = ?', id);
  }

  renew(id: string, expiresAt: string): void {
    run(this.db, 'UPDATE pr_note SET expires_at = ? WHERE id = ?', expiresAt, id);
  }

  clear(id: string, at: string, by: string): void {
    run(this.db, 'UPDATE pr_note SET cleared_at = ?, cleared_by = ?, idempotency_key = NULL WHERE id = ? AND cleared_at IS NULL', at, by, id);
  }
}

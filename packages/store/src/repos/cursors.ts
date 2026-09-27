import type { DatabaseSync } from 'node:sqlite';
import type { Cursor, CursorKind } from '@code-manager/core';
import { all, one, run } from '../sql.ts';

interface CursorRow {
  kind: string;
  scope: string;
  seq: number;
  dossier_version: number | null;
  updated_at: string;
}

function toCursor(row: CursorRow): Cursor {
  return {
    kind: row.kind as CursorKind,
    scope: row.scope,
    seq: row.seq,
    dossierVersion: row.dossier_version,
    updatedAt: row.updated_at,
  };
}

/** Where each reader of the event log stands. See CursorKind. */
export class CursorRepo {
  constructor(private readonly db: DatabaseSync) {}

  get(kind: CursorKind, scope: string): Cursor | null {
    const row = one<CursorRow>(this.db, 'SELECT * FROM cursor WHERE kind = ? AND scope = ?', kind, scope);
    return row ? toCursor(row) : null;
  }

  /** Every cursor of one kind, keyed by scope. */
  listByKind(kind: CursorKind): Map<string, Cursor> {
    const rows = all<CursorRow>(this.db, 'SELECT * FROM cursor WHERE kind = ? ORDER BY scope', kind);
    return new Map(rows.map((row) => [row.scope, toCursor(row)]));
  }

  /**
   * Upsert. A cursor only moves forward: a lower seq than the stored one is
   * ignored. The same seq still updates the rest (marking a topic seen again
   * after a dossier update with no new events).
   */
  advance(cursor: Cursor): void {
    run(
      this.db,
      `INSERT INTO cursor (kind, scope, seq, dossier_version, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (kind, scope) DO UPDATE SET
         seq = excluded.seq, dossier_version = excluded.dossier_version, updated_at = excluded.updated_at
       WHERE excluded.seq >= cursor.seq`,
      cursor.kind,
      cursor.scope,
      cursor.seq,
      cursor.dossierVersion,
      cursor.updatedAt,
    );
  }
}

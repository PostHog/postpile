import type { DatabaseSync } from 'node:sqlite';
import type { Cursor, CursorKind } from '@code-manager/core';

/** Where each reader of the event log stands. See CursorKind. */
export class CursorRepo {
  constructor(private readonly db: DatabaseSync) {}

  get(kind: CursorKind, scope: string): Cursor | null {
    throw new Error('not implemented: CursorRepo.get');
  }

  /** Every cursor of one kind, keyed by scope. */
  listByKind(kind: CursorKind): Map<string, Cursor> {
    throw new Error('not implemented: CursorRepo.listByKind');
  }

  /** Upsert. A cursor only moves forward: a lower seq than the stored one is ignored. */
  advance(cursor: Cursor): void {
    throw new Error('not implemented: CursorRepo.advance');
  }
}

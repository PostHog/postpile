import type { DatabaseSync } from 'node:sqlite';
import type { ActionOrigin, PendingThread, PendingWrite, PrKey } from '@postpile/core';
import { all, insertReturningId, run } from '../sql.ts';

interface PendingWriteRow {
  id: number;
  created_at: string;
  origin: string;
  tile_id: string | null;
  batch: string;
  pr_keys: string;
  handle_keys: string;
  threads: string;
  error: string | null;
  tried_at: string | null;
}

function toPendingWrite(row: PendingWriteRow): PendingWrite {
  return {
    id: row.id,
    createdAt: row.created_at,
    origin: row.origin as ActionOrigin,
    tileId: row.tile_id,
    batch: row.batch,
    prKeys: JSON.parse(row.pr_keys) as PrKey[],
    handleKeys: JSON.parse(row.handle_keys) as PrKey[],
    threads: JSON.parse(row.threads) as PendingThread[],
    error: row.error,
    triedAt: row.tried_at,
  };
}

export type NewPendingWrite = Omit<PendingWrite, 'id' | 'error' | 'triedAt'>;

/** Mark-reads waiting for the writes lock, one row per click. */
export class PendingWriteRepo {
  constructor(private readonly db: DatabaseSync) {}

  add(write: NewPendingWrite): number {
    return insertReturningId(
      this.db,
      `INSERT INTO pending_write (created_at, origin, tile_id, batch, pr_keys, handle_keys, threads)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      write.createdAt,
      write.origin,
      write.tileId,
      write.batch,
      JSON.stringify(write.prKeys),
      JSON.stringify(write.handleKeys),
      JSON.stringify(write.threads),
    );
  }

  /** Oldest first. */
  list(): PendingWrite[] {
    return all<PendingWriteRow>(this.db, 'SELECT * FROM pending_write ORDER BY id').map(toPendingWrite);
  }

  /** After a send that left some threads unsent: the rest stay, with the error. */
  keepAfterTry(id: number, threads: PendingThread[], error: string, at: string): void {
    run(this.db, 'UPDATE pending_write SET threads = ?, error = ?, tried_at = ? WHERE id = ?', JSON.stringify(threads), error, at, id);
  }

  remove(id: number): void {
    run(this.db, 'DELETE FROM pending_write WHERE id = ?', id);
  }
}

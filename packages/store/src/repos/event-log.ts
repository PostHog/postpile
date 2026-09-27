import type { DatabaseSync } from 'node:sqlite';
import type { LoggedEvent, PrKey } from '@code-manager/core';

/**
 * The append-only event log. A row is written the first time an event id is
 * seen and never changes. Cursors count in its seq.
 */
export class EventLogRepo {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * Logs event ids not logged yet (INSERT OR IGNORE), in the given order.
   * Called with the ids EventRepo.upsertDerived reports as new, in the same transaction.
   */
  append(events: { id: string; prKey: PrKey }[], at: string): void {
    throw new Error('not implemented: EventLogRepo.append');
  }

  /** Highest seq so far, 0 on an empty log. */
  maxSeq(): number {
    throw new Error('not implemented: EventLogRepo.maxSeq');
  }

  /**
   * Events of these PRs logged after afterSeq, oldest seq first, joined with
   * pr_event. Log rows whose pr_event is gone (deleted comment) are skipped.
   */
  listSince(prKeys: PrKey[], afterSeq: number): LoggedEvent[] {
    throw new Error('not implemented: EventLogRepo.listSince');
  }

  /** Count only, for "N events since" badges without loading rows. */
  countSince(prKeys: PrKey[], afterSeq: number): number {
    throw new Error('not implemented: EventLogRepo.countSince');
  }
}

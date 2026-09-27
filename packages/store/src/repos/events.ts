import type { DatabaseSync } from 'node:sqlite';
import type { LoudnessOverride, PrEvent, PrKey } from '@code-manager/core';

export class EventRepo {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * Writes freshly derived events for one PR. Keeps seen_at and override_* of
   * events that already exist. Returns the ids that were new.
   */
  upsertDerived(_prKey: PrKey, _events: PrEvent[]): string[] {
    throw new Error('not implemented');
  }

  listForPr(_prKey: PrKey): PrEvent[] {
    throw new Error('not implemented');
  }

  listForPrs(_prKeys: PrKey[]): Map<PrKey, PrEvent[]> {
    throw new Error('not implemented');
  }

  markSeen(_eventIds: string[], _at: string): void {
    throw new Error('not implemented');
  }

  setOverride(_eventId: string, _override: LoudnessOverride | null): void {
    throw new Error('not implemented');
  }
}

import type { DatabaseSync } from 'node:sqlite';
import type { NotificationThread, PrKey } from '@code-manager/core';

export class NotificationRepo {
  constructor(private readonly db: DatabaseSync) {}

  upsertMany(_threads: NotificationThread[]): void {
    throw new Error('not implemented');
  }

  list(): NotificationThread[] {
    throw new Error('not implemented');
  }

  getByPrKey(_prKey: PrKey): NotificationThread | null {
    throw new Error('not implemented');
  }

  /** Local mirror of a mark-read that was actually sent to GitHub. */
  markRead(_threadId: string, _at: string): void {
    throw new Error('not implemented');
  }
}

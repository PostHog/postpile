import type { DatabaseSync } from 'node:sqlite';
import type { Snooze } from '@code-manager/core';

export class SnoozeRepo {
  constructor(private readonly db: DatabaseSync) {}

  get(_tileId: string): Snooze | null {
    throw new Error('not implemented');
  }

  list(): Snooze[] {
    throw new Error('not implemented');
  }

  put(_snooze: Snooze): void {
    throw new Error('not implemented');
  }

  remove(_tileId: string): void {
    throw new Error('not implemented');
  }
}

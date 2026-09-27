import type { DatabaseSync } from 'node:sqlite';
import type { PrKey, PrSet } from '@code-manager/core';

export class PrSetRepo {
  constructor(private readonly db: DatabaseSync) {}

  /** Insert or replace the set and all of its members. */
  save(_set: PrSet): void {
    throw new Error('not implemented');
  }

  get(_id: string): PrSet | null {
    throw new Error('not implemented');
  }

  listActiveForTopic(_topicId: string): PrSet[] {
    throw new Error('not implemented');
  }

  /** User said "not related" about one member. */
  removeMember(_setId: string, _prKey: PrKey, _at: string): void {
    throw new Error('not implemented');
  }

  dissolve(_id: string, _at: string): void {
    throw new Error('not implemented');
  }
}

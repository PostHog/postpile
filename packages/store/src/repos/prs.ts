import type { DatabaseSync } from 'node:sqlite';
import type { Pr, PrKey } from '@code-manager/core';

export class PrRepo {
  constructor(private readonly db: DatabaseSync) {}

  upsert(_pr: Pr, _fetchedAt: string): void {
    throw new Error('not implemented');
  }

  get(_key: PrKey): Pr | null {
    throw new Error('not implemented');
  }

  getMany(_keys: PrKey[]): Map<PrKey, Pr> {
    throw new Error('not implemented');
  }

  listByRepo(_repo: string): Pr[] {
    throw new Error('not implemented');
  }

  /** updated_at per stored PR, so sync can skip PRs that did not move. */
  updatedAtByKey(): Map<PrKey, string> {
    throw new Error('not implemented');
  }
}

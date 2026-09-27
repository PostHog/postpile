import type { DatabaseSync } from 'node:sqlite';
import type { PrKey, UserPrState } from '@code-manager/core';

export class UserPrStateRepo {
  constructor(private readonly db: DatabaseSync) {}

  get(_prKey: PrKey): UserPrState | null {
    throw new Error('not implemented');
  }

  getMany(_prKeys: PrKey[]): Map<PrKey, UserPrState> {
    throw new Error('not implemented');
  }

  markApproved(_prKey: PrKey, _commitOid: string, _at: string): void {
    throw new Error('not implemented');
  }

  markHandled(_prKey: PrKey, _at: string): void {
    throw new Error('not implemented');
  }

  /** Undo of a local mark-read inside the 6s window. */
  clearHandled(_prKey: PrKey): void {
    throw new Error('not implemented');
  }
}

import type { DatabaseSync } from 'node:sqlite';
import type { Glance, PrKey } from '@code-manager/core';

export class GlanceRepo {
  constructor(private readonly db: DatabaseSync) {}

  get(_prKey: PrKey): Glance | null {
    throw new Error('not implemented');
  }

  getMany(_prKeys: PrKey[]): Map<PrKey, Glance> {
    throw new Error('not implemented');
  }

  put(_glance: Glance): void {
    throw new Error('not implemented');
  }
}

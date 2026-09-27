import type { DatabaseSync } from 'node:sqlite';

/** Small key/value facts: notifications ETag and Last-Modified, viewer login, teams JSON. */
export class MetaRepo {
  constructor(private readonly db: DatabaseSync) {}

  get(_key: string): string | null {
    throw new Error('not implemented');
  }

  set(_key: string, _value: string): void {
    throw new Error('not implemented');
  }
}

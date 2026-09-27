import type { DatabaseSync } from 'node:sqlite';
import { one, run } from '../sql.ts';

/** Small key/value facts: notifications ETag and Last-Modified, viewer login, teams JSON. */
export class MetaRepo {
  constructor(private readonly db: DatabaseSync) {}

  get(key: string): string | null {
    const row = one<{ value: string }>(this.db, 'SELECT value FROM meta WHERE key = ?', key);
    return row ? row.value : null;
  }

  set(key: string, value: string): void {
    run(
      this.db,
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      key,
      value,
    );
  }

  delete(key: string): void {
    run(this.db, 'DELETE FROM meta WHERE key = ?', key);
  }
}

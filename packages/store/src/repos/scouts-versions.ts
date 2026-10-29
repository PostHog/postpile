import type { DatabaseSync } from 'node:sqlite';
import type { ScoutsOrigin, ScoutsVersion } from '@postpile/core';
import { inTransaction } from '../database.ts';
import { all, one, run } from '../sql.ts';

interface ScoutsVersionRow {
  version: number;
  text: string;
  summary: string;
  origin: string;
  created_at: string;
}

function toVersion(row: ScoutsVersionRow): ScoutsVersion {
  return { version: row.version, text: row.text, summary: row.summary, origin: row.origin as ScoutsOrigin, createdAt: row.created_at };
}

export type NewScoutsVersion = Omit<ScoutsVersion, 'version'>;

/** Every known version of scouts.md, numbered 1, 2, 3, ... Never pruned: the text is small and the user's own. */
export class ScoutsVersionRepo {
  constructor(private readonly db: DatabaseSync) {}

  latest(): ScoutsVersion | null {
    const row = one<ScoutsVersionRow>(this.db, 'SELECT * FROM scouts_version ORDER BY version DESC LIMIT 1');
    return row ? toVersion(row) : null;
  }

  get(version: number): ScoutsVersion | null {
    const row = one<ScoutsVersionRow>(this.db, 'SELECT * FROM scouts_version WHERE version = ?', version);
    return row ? toVersion(row) : null;
  }

  /** Newest first. */
  list(limit: number): ScoutsVersion[] {
    return all<ScoutsVersionRow>(this.db, 'SELECT * FROM scouts_version ORDER BY version DESC LIMIT ?', limit).map(toVersion);
  }

  /** Stores the next version and returns it. */
  add(version: NewScoutsVersion): ScoutsVersion {
    return inTransaction(this.db, () => {
      const next = (this.latest()?.version ?? 0) + 1;
      run(
        this.db,
        'INSERT INTO scouts_version (version, text, summary, origin, created_at) VALUES (?, ?, ?, ?, ?)',
        next,
        version.text,
        version.summary,
        version.origin,
        version.createdAt,
      );
      return { version: next, ...version };
    });
  }
}

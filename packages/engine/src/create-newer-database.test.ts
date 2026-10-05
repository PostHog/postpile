import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LATEST_VERSION, NewerDatabaseError, runMigrations } from '@postpile/store';
import { afterEach, describe, expect, it } from 'vitest';
import { createEngine } from './create.ts';
import { LOCK_FILE_NAME } from './data-lock.ts';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('createEngine on a database from a newer PostPile', () => {
  it('throws NewerDatabaseError and lets the data folder lock go', () => {
    const dir = mkdtempSync(join(tmpdir(), 'postpile-newer-engine-'));
    dirs.push(dir);
    const paths = { databaseFile: join(dir, 'db.sqlite'), instructionsFile: join(dir, 'instructions.md') };
    const db = new DatabaseSync(paths.databaseFile);
    runMigrations(db);
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(LATEST_VERSION + 1, '2026-10-05T00:00:00.000Z');
    db.close();

    expect(() => createEngine({ paths, lockKind: 'cli' })).toThrow(NewerDatabaseError);
    expect(existsSync(join(dir, LOCK_FILE_NAME))).toBe(false);
  });
});

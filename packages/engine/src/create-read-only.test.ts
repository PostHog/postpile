import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '@postpile/store';
import { afterEach, describe, expect, it } from 'vitest';
import { createEngine } from './create.ts';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('createEngine without the lock', () => {
  it('reads the database read-only, next to a process that holds it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'postpile-nolock-'));
    dirs.push(dir);
    const paths = { databaseFile: join(dir, 'db.sqlite'), instructionsFile: join(dir, 'instructions.md') };
    const holder = Store.open(paths.databaseFile);

    const engine = createEngine({ paths, withoutLock: true });
    expect(await engine.listTopics()).toEqual([]);
    await engine.close();
    holder.close();
  });
});

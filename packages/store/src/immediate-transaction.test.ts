import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { isBusyError, Store } from './index.ts';

const dirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'postpile-immediate-'));
  dirs.push(dir);
  return join(dir, 'db.sqlite');
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('Store.immediateTransaction', () => {
  it('commits what fn wrote, and rolls it back when fn throws', () => {
    const store = Store.open(':memory:');
    store.immediateTransaction(0, () => store.meta.set('kept', '1'));
    expect(() =>
      store.immediateTransaction(0, () => {
        store.meta.set('dropped', '1');
        throw new Error('boom');
      }),
    ).toThrow('boom');

    expect(store.meta.get('kept')).toBe('1');
    expect(store.meta.get('dropped')).toBeNull();
    expect(store.db.isTransaction).toBe(false);
    store.close();
  });

  it('gives up at once while another connection holds the write lock, and keeps the connection busy timeout', () => {
    const path = tempDb();
    const store = Store.open(path);
    const other = new DatabaseSync(path);
    other.exec('BEGIN IMMEDIATE');

    const started = Date.now();
    let refused: unknown = null;
    try {
      store.immediateTransaction(0, () => store.meta.set('k', 'v'));
    } catch (error) {
      refused = error;
    }

    expect(isBusyError(refused)).toBe(true);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(store.db.isTransaction).toBe(false);
    expect(store.db.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 5000 });
    other.exec('ROLLBACK');
    other.close();
    store.immediateTransaction(0, () => store.meta.set('k', 'v'));
    expect(store.meta.get('k')).toBe('v');
    store.close();
  });

  it('tells SQLITE_BUSY from other errors', () => {
    expect(isBusyError(Object.assign(new Error('database is locked'), { errcode: 5 }))).toBe(true);
    expect(isBusyError(Object.assign(new Error('busy snapshot'), { errcode: 517 }))).toBe(true);
    expect(isBusyError(Object.assign(new Error('constraint'), { errcode: 19 }))).toBe(false);
    expect(isBusyError(new Error('plain'))).toBe(false);
    expect(isBusyError(null)).toBe(false);
  });
});

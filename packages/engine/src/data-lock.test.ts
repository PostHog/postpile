import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DataDirLock, DataDirLockedError, LOCK_FILE_NAME } from './data-lock.ts';

const dirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'postpile-lock-'));
  dirs.push(dir);
  return join(dir, 'db.sqlite');
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('DataDirLock', () => {
  it('takes the lock with pid, kind and start time, and releases it', () => {
    const db = tempDb();
    const lock = DataDirLock.acquire(db, 'cli', '2026-09-28T10:00:00.000Z');
    const file = join(db, '..', LOCK_FILE_NAME);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ pid: process.pid, kind: 'cli', startedAt: '2026-09-28T10:00:00.000Z', databaseFile: db });
    lock.release();
    lock.release();
    expect(existsSync(file)).toBe(false);
  });

  it('refuses while another live process holds it', () => {
    const db = tempDb();
    // The parent process (the test runner) is alive and is not us.
    const holder = { pid: process.ppid, kind: 'dev', startedAt: '2026-09-28T09:00:00.000Z', databaseFile: db };
    writeFileSync(join(db, '..', LOCK_FILE_NAME), JSON.stringify(holder));
    expect(() => DataDirLock.acquire(db, 'server')).toThrow(DataDirLockedError);
    expect(() => DataDirLock.acquire(db, 'server')).toThrow(
      `PostPile is already running with this database (pid ${process.ppid}, dev, since 2026-09-28T09:00:00.000Z): ${db}`,
    );
  });

  it('takes over a stale lock left by a dead process', () => {
    const db = tempDb();
    // Far above any real pid on macOS and Linux.
    writeFileSync(join(db, '..', LOCK_FILE_NAME), JSON.stringify({ pid: 99_999_999, kind: 'packaged', startedAt: 'x', databaseFile: db }));
    const lock = DataDirLock.acquire(db, 'dev');
    expect(lock.info.kind).toBe('dev');
    lock.release();
  });

  it('does not remove a lock that another process took over meanwhile', () => {
    const db = tempDb();
    const lock = DataDirLock.acquire(db, 'cli');
    const file = join(db, '..', LOCK_FILE_NAME);
    writeFileSync(file, JSON.stringify({ pid: process.ppid, kind: 'dev', startedAt: 'x', databaseFile: db }));
    lock.release();
    expect(existsSync(file)).toBe(true);
  });
});

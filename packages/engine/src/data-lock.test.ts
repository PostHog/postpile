import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DataDirLock, DataDirLockedError, LOCK_FILE_NAME, processStartTime, runningApp, removeStaleLock, takeoverDir, type LockInfo, type LockKind } from './data-lock.ts';

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
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      pid: process.pid,
      kind: 'cli',
      startedAt: '2026-09-28T10:00:00.000Z',
      databaseFile: db,
      processStartedAt: expect.any(String),
    });
    lock.release();
    lock.release();
    expect(existsSync(file)).toBe(false);
  });

  it('writes the app version into the lock when it has one', () => {
    const db = tempDb();
    const lock = DataDirLock.acquire(db, 'packaged', undefined, '0.13.1');
    expect(runningApp(db)?.appVersion).toBe('0.13.1');
    lock.release();
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

  it('records the process start as ps reports it, so the holder check agrees', () => {
    const db = tempDb();
    const lock = DataDirLock.acquire(db, 'dev');
    expect(lock.info.processStartedAt).toBe(new Date(processStartTime(process.pid)!).toISOString());
    expect(runningApp(db)?.pid).toBe(process.pid);
    lock.release();
  });

  it('refuses while the holder is the same process it names, by start time', () => {
    const db = tempDb();
    const started = processStartTime(process.ppid);
    expect(started).not.toBeNull();
    const holder = { pid: process.ppid, kind: 'dev', startedAt: 'x', databaseFile: db, processStartedAt: new Date(started!).toISOString() };
    writeFileSync(join(db, '..', LOCK_FILE_NAME), JSON.stringify(holder));
    expect(() => DataDirLock.acquire(db, 'server')).toThrow(DataDirLockedError);
  });

  it('still sees the holder when its lock start trails ps by seconds (an uptime-written lock)', () => {
    const db = tempDb();
    const started = processStartTime(process.ppid);
    expect(started).not.toBeNull();
    const holder = { pid: process.ppid, kind: 'packaged', startedAt: 'x', databaseFile: db, processStartedAt: new Date(started! + 9000).toISOString() };
    writeFileSync(join(db, '..', LOCK_FILE_NAME), JSON.stringify(holder));
    expect(runningApp(db)?.pid).toBe(process.ppid);
  });

  it('takes over a lock whose pid now belongs to another process', () => {
    const db = tempDb();
    // The pid is alive (the test runner), but it started long after this lock's process.
    const holder = { pid: process.ppid, kind: 'packaged', startedAt: 'x', databaseFile: db, processStartedAt: '2001-01-01T00:00:00.000Z' };
    writeFileSync(join(db, '..', LOCK_FILE_NAME), JSON.stringify(holder));
    const lock = DataDirLock.acquire(db, 'dev');
    expect(lock.info.kind).toBe('dev');
    lock.release();
  });

  it('takes over a lock file that stays unreadable', () => {
    const db = tempDb();
    writeFileSync(join(db, '..', LOCK_FILE_NAME), '');
    const lock = DataDirLock.acquire(db, 'dev');
    expect(lock.info.kind).toBe('dev');
    lock.release();
  });

  it('removes a stale lock only while it is still the holder judged stale', () => {
    const db = tempDb();
    const file = join(db, '..', LOCK_FILE_NAME);
    const stale: LockInfo = { pid: 99_999_999, kind: 'packaged', startedAt: 'x', databaseFile: db, processStartedAt: '2026-09-28T09:00:00.000Z' };
    // Another process took the stale lock over between our check and our remove.
    const fresh: LockInfo = { pid: process.ppid, kind: 'dev', startedAt: 'y', databaseFile: db, processStartedAt: '2026-09-28T10:00:00.000Z' };
    writeFileSync(file, JSON.stringify(fresh));
    expect(removeStaleLock(file, stale)).toBe(false);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(fresh);
    // Same pid, other process start: a new holder too.
    writeFileSync(file, JSON.stringify({ ...stale, processStartedAt: '2026-09-28T11:00:00.000Z' }));
    expect(removeStaleLock(file, stale)).toBe(false);
    // A lock that turned readable meanwhile is not the unreadable one judged stale.
    expect(removeStaleLock(file, null)).toBe(false);
    writeFileSync(file, JSON.stringify(stale));
    expect(removeStaleLock(file, stale)).toBe(true);
    expect(existsSync(file)).toBe(false);
  });

  it('leaves a stale lock alone while a second contender holds the takeover folder', () => {
    const db = tempDb();
    const file = join(db, '..', LOCK_FILE_NAME);
    const stale = { pid: 99_999_999, kind: 'packaged', startedAt: 'x', databaseFile: db };
    writeFileSync(file, JSON.stringify(stale));
    // The other contender is mid-takeover: it holds the mutex.
    mkdirSync(takeoverDir(file));

    expect(() => DataDirLock.acquire(db, 'dev')).toThrow(`could not take the lock ${file}`);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(stale);
    expect(existsSync(takeoverDir(file))).toBe(true);
  });

  it('sees the lock the second contender wrote once its takeover is done', () => {
    const db = tempDb();
    const file = join(db, '..', LOCK_FILE_NAME);
    writeFileSync(file, JSON.stringify({ pid: 99_999_999, kind: 'packaged', startedAt: 'x', databaseFile: db }));
    // The contender took over first: its fresh lock (a live pid) is in place, its mutex gone.
    writeFileSync(file, JSON.stringify({ pid: process.ppid, kind: 'dev', startedAt: 'y', databaseFile: db }));

    expect(() => DataDirLock.acquire(db, 'server')).toThrow(DataDirLockedError);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ pid: process.ppid, kind: 'dev' });
  });

  it('removes an abandoned takeover folder and takes the stale lock over, cleaning up after itself', () => {
    const db = tempDb();
    const file = join(db, '..', LOCK_FILE_NAME);
    writeFileSync(file, JSON.stringify({ pid: 99_999_999, kind: 'packaged', startedAt: 'x', databaseFile: db }));
    mkdirSync(takeoverDir(file));
    const longAgo = new Date(Date.now() - 60_000);
    utimesSync(takeoverDir(file), longAgo, longAgo);

    const lock = DataDirLock.acquire(db, 'dev');

    expect(lock.info.kind).toBe('dev');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ pid: process.pid, kind: 'dev' });
    expect(existsSync(takeoverDir(file))).toBe(false);
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

describe('runningApp', () => {
  function writeLock(db: string, pid: number, kind: LockKind = 'packaged'): void {
    const info: LockInfo = { pid, kind, startedAt: '2026-10-01T10:00:00.000Z', databaseFile: db };
    writeFileSync(join(db, '..', LOCK_FILE_NAME), JSON.stringify(info));
  }

  it('finds a live app, and not a missing lock, a dead pid or a CLI holder', () => {
    const db = tempDb();
    expect(runningApp(db)).toBeNull();
    writeLock(db, process.pid);
    expect(runningApp(db)?.pid).toBe(process.pid);
    writeLock(db, process.pid, 'server');
    expect(runningApp(db)?.kind).toBe('server');
    writeLock(db, process.pid, 'cli');
    expect(runningApp(db)).toBeNull();
    // A lock left by a crashed app: that pid is gone.
    writeLock(db, 2 ** 22 + 12345);
    expect(runningApp(db)).toBeNull();
  });
});

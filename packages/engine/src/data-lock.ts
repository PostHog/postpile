import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const LOCK_FILE_NAME = 'postpile.lock';

/** Who holds a data folder: the packaged app, a dev run of the desktop app, the CLI or the standalone server. */
export type LockKind = 'packaged' | 'dev' | 'cli' | 'server';

export interface LockInfo {
  pid: number;
  kind: LockKind;
  startedAt: string;
  databaseFile: string;
}

/** Thrown when another live process holds the data folder. The message is meant for the user. */
export class DataDirLockedError extends Error {
  constructor(
    readonly holder: LockInfo,
    readonly lockFile: string,
  ) {
    super(`PostPile is already running with this database (pid ${holder.pid}, ${holder.kind}, since ${holder.startedAt}): ${holder.databaseFile}`);
  }
}

/** process.kill(pid, 0) only checks: ESRCH means gone, EPERM means alive but not ours. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readLock(file: string): LockInfo | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as LockInfo;
  } catch {
    return null;
  }
}

/** Creates the file only if it does not exist yet (O_EXCL). False when it does. */
function createExclusive(file: string, info: LockInfo): boolean {
  let fd: number;
  try {
    fd = openSync(file, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false;
    }
    throw error;
  }
  try {
    writeSync(fd, `${JSON.stringify(info, null, 2)}\n`);
  } finally {
    closeSync(fd);
  }
  return true;
}

/**
 * An exclusive lock on the folder of a database: `<folder>/postpile.lock`
 * with pid, kind and start time. A second process refuses to open the same
 * database. A lock left by a dead process (crash, kill -9) is stale and
 * taken over. Released on close and on process exit.
 */
export class DataDirLock {
  private released = false;
  private readonly onExit = () => this.release();

  private constructor(
    readonly lockFile: string,
    readonly info: LockInfo,
  ) {
    process.once('exit', this.onExit);
  }

  static acquire(databaseFile: string, kind: LockKind, startedAt: string = new Date().toISOString()): DataDirLock {
    const folder = dirname(databaseFile);
    mkdirSync(folder, { recursive: true });
    const lockFile = join(folder, LOCK_FILE_NAME);
    const info: LockInfo = { pid: process.pid, kind, startedAt, databaseFile };
    // Two tries: the second one after removing a stale lock.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (createExclusive(lockFile, info)) {
        return new DataDirLock(lockFile, info);
      }
      const holder = readLock(lockFile);
      if (holder && holder.pid !== process.pid && isProcessAlive(holder.pid)) {
        throw new DataDirLockedError(holder, lockFile);
      }
      // Dead holder, our own pid from an earlier run, or an unreadable file: stale.
      rmSync(lockFile, { force: true });
    }
    throw new Error(`could not take the lock ${lockFile}`);
  }

  /** Removes the lock file if it is still ours. Safe to call twice. */
  release(): void {
    if (this.released) {
      return;
    }
    this.released = true;
    process.removeListener('exit', this.onExit);
    if (existsSync(this.lockFile) && readLock(this.lockFile)?.pid === this.info.pid) {
      rmSync(this.lockFile, { force: true });
    }
  }
}

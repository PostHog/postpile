import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const LOCK_FILE_NAME = 'postpile.lock';

/** Who holds a data folder: the packaged app, a dev run of the desktop app, the CLI or the standalone server. */
export type LockKind = 'packaged' | 'dev' | 'cli' | 'server';

export interface LockInfo {
  pid: number;
  kind: LockKind;
  startedAt: string;
  databaseFile: string;
  /** When the holding process started. Tells a live holder from a new process that got the same pid. Missing in old lock files. */
  processStartedAt?: string;
}

/** An unreadable lock file may be one being written right now: read it this often, this far apart, before calling it stale. */
const UNREADABLE_RETRIES = 5;
const UNREADABLE_RETRY_MS = 20;
/** ps reports start times to the second; a holder whose start time differs by more is another process on a reused pid. */
const START_TIME_SLACK_MS = 2000;
/** A takeover folder this old was left by a process that died while taking over. */
export const TAKEOVER_ABANDONED_MS = 30_000;
/** How long to wait before trying again while another process takes the lock over. */
const TAKEOVER_BACKOFF_MS = 50;
/** Tries to take the lock: the later ones after a stale lock was found. */
const ACQUIRE_ATTEMPTS = 3;

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

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** readLock, retried briefly: another process may have created the file and not written it yet. */
function readLockPatiently(file: string): LockInfo | null {
  for (let attempt = 0; attempt < UNREADABLE_RETRIES; attempt++) {
    const info = readLock(file);
    if (info !== null || !existsSync(file)) {
      return info;
    }
    sleepSync(UNREADABLE_RETRY_MS);
  }
  return null;
}

/** When a live process started, from `ps`, in ms. Null when ps cannot tell. */
export function processStartTime(pid: number): number | null {
  const result = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
  if (result.status !== 0) {
    return null;
  }
  const parsed = Date.parse(result.stdout.trim());
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * When this process started, from `ps`: the same clock and precision
 * `holderAlive` checks against. `process.uptime()` counts from Node's start,
 * which in Electron can come seconds after the process's, and a live app
 * then looked like a reused pid. That estimate stays as the fallback.
 */
function ownProcessStart(): string {
  const started = processStartTime(process.pid) ?? Date.now() - process.uptime() * 1000;
  return new Date(started).toISOString();
}

/**
 * The holder's process is still the one that wrote the lock: alive, and
 * started when the lock says (when both the lock and ps can tell).
 */
function holderAlive(holder: LockInfo): boolean {
  if (!isProcessAlive(holder.pid)) {
    return false;
  }
  if (holder.processStartedAt === undefined) {
    return true;
  }
  const started = processStartTime(holder.pid);
  return started === null || Math.abs(started - Date.parse(holder.processStartedAt)) <= START_TIME_SLACK_MS;
}

/** Lock kinds of the desktop app: the only holder that runs the live poll and answers agent requests. */
export const APP_LOCK_KINDS: readonly LockKind[] = ['packaged', 'dev'];

/**
 * The desktop app holding this database's folder right now, or null: no
 * lock, a stale one, or the CLI or the standalone server holds it. Reads
 * only, never takes or removes the lock (the MCP process asks this).
 */
export function runningApp(databaseFile: string): LockInfo | null {
  const holder = readLock(join(dirname(databaseFile), LOCK_FILE_NAME));
  if (!holder || !APP_LOCK_KINDS.includes(holder.kind) || !holderAlive(holder)) {
    return null;
  }
  return holder;
}

/** The same lock holder: same pid and same process start (both missing counts as the same). */
function sameHolder(a: LockInfo, b: LockInfo): boolean {
  return a.pid === b.pid && a.processStartedAt === b.processStartedAt;
}

/**
 * Removes a lock judged stale, but only while it is still that exact holder
 * (`stale`, or still unreadable when `stale` is null). Two processes can
 * find the same stale lock; the slower one would otherwise delete the fresh
 * lock the faster one just wrote. True when it removed the file. Called
 * only while holding the takeover folder (`takeOver`), so nobody else can
 * write a new lock between the read and the remove.
 */
export function removeStaleLock(file: string, stale: LockInfo | null): boolean {
  const current = readLock(file);
  const unchanged = stale === null ? current === null : current !== null && sameHolder(current, stale);
  if (!unchanged) {
    return false;
  }
  rmSync(file, { force: true });
  return true;
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

/** The takeover mutex next to the lock file. */
export function takeoverDir(lockFile: string): string {
  return `${lockFile}.takeover`;
}

/**
 * Creates the takeover folder (mkdir is atomic: exactly one process gets
 * it). A folder older than TAKEOVER_ABANDONED_MS was left by a process that
 * died mid-takeover and is removed first. False while someone else holds it.
 */
function claimTakeover(dir: string): boolean {
  try {
    if (Date.now() - statSync(dir).mtimeMs > TAKEOVER_ABANDONED_MS) {
      rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    // No folder yet: nothing abandoned.
  }
  try {
    mkdirSync(dir);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false;
    }
    throw error;
  }
}

/**
 * Replaces a stale lock under the takeover folder: re-read it, remove it
 * only if it is still the holder judged stale, create ours exclusively and
 * read it back. Only one process runs this at a time, so two processes
 * finding the same stale lock can no longer delete each other's fresh one.
 * False when someone else is taking over, the holder changed, or another
 * process created the lock first; the caller then tries again.
 */
function takeOver(lockFile: string, stale: LockInfo | null, info: LockInfo): boolean {
  const dir = takeoverDir(lockFile);
  if (!claimTakeover(dir)) {
    sleepSync(TAKEOVER_BACKOFF_MS);
    return false;
  }
  try {
    if (!removeStaleLock(lockFile, stale)) {
      return false;
    }
    return createExclusive(lockFile, info) && readLock(lockFile)?.pid === info.pid;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * An exclusive lock on the folder of a database: `<folder>/postpile.lock`
 * with pid, kind and start time. A second process refuses to open the same
 * database. A lock left by a dead process (crash, kill -9) is stale and
 * taken over, one process at a time (`takeOver`). Released on close and on
 * process exit.
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
    const info: LockInfo = { pid: process.pid, kind, startedAt, databaseFile, processStartedAt: ownProcessStart() };
    for (let attempt = 0; attempt < ACQUIRE_ATTEMPTS; attempt++) {
      // Read back after creating: a process taking over the same stale lock may have replaced ours.
      if (createExclusive(lockFile, info) && readLock(lockFile)?.pid === process.pid) {
        return new DataDirLock(lockFile, info);
      }
      const holder = readLockPatiently(lockFile);
      if (holder && holder.pid !== process.pid && holderAlive(holder)) {
        throw new DataDirLockedError(holder, lockFile);
      }
      // Dead holder, a reused pid, our own pid from an earlier run, or a file that stayed unreadable: stale.
      if (takeOver(lockFile, holder, info)) {
        return new DataDirLock(lockFile, info);
      }
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

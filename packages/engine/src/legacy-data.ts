import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATABASE_FILE_NAME, legacyDataDirs, profileFromEnv, realDataDirs, systemPathEnv, type PathEnv } from './paths.ts';

// One-time move of the data from the code-manager folders to the PostPile
// ones (renamed 2026-09-28). Safe to call on every start: once the new
// folder has its database (or instructions), it does nothing.

export type MigrationOutcome =
  /** Nothing to do: no old folder, or the new one is already in use. */
  | { kind: 'nothing' }
  /** The old folder was renamed to the new one. */
  | { kind: 'moved' }
  /** The new folder existed without data; the old entries were moved into it. */
  | { kind: 'merged'; left: string[] }
  /** Copied, old folder kept with a README note. */
  | { kind: 'copied'; reason: string }
  | { kind: 'failed'; reason: string };

export interface LegacyDirMove {
  from: string;
  to: string;
  /** A file whose presence in `to` means the new folder is already in use. */
  marker: string;
  /** Name of the SQLite file inside the folder, when it holds one. */
  databaseName?: string;
}

type LockState = 'free' | 'busy' | 'unknown';

const DATABASE_SIDECARS = ['-wal', '-shm'];

/**
 * Whether another connection holds the database. An exclusive lock with no
 * wait fails with "database is locked" while any other process (or
 * connection) has it open, idle WAL readers included.
 */
function databaseLockState(file: string): LockState {
  if (!existsSync(file)) {
    return 'free';
  }
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(file);
    db.exec('PRAGMA busy_timeout = 0');
    db.exec('PRAGMA locking_mode = EXCLUSIVE');
    db.exec('BEGIN EXCLUSIVE');
    db.exec('COMMIT');
    return 'free';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return /locked|busy/i.test(message) ? 'busy' : 'unknown';
  } finally {
    db?.close();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function writeNote(dir: string, lines: string[]): void {
  try {
    writeFileSync(join(dir, 'README-moved-to-postpile.txt'), `${lines.join('\n')}\n`);
  } catch {
    // The note is a courtesy; the move itself already happened or was logged.
  }
}

/** Moves each entry of `from` that `to` does not have yet. Returns what stayed behind. */
function mergeInto(from: string, to: string): string[] {
  const left: string[] = [];
  for (const name of readdirSync(from)) {
    if (existsSync(join(to, name))) {
      left.push(name);
    } else {
      renameSync(join(from, name), join(to, name));
    }
  }
  if (left.length === 0) {
    rmdirSync(from);
  }
  return left;
}

/**
 * Copies instead of moving. The database goes through VACUUM INTO, which
 * gives a consistent snapshot even while another process writes to it.
 */
function copyInto(move: LegacyDirMove, reason: string): MigrationOutcome {
  const sqliteFiles = move.databaseName
    ? [move.databaseName, ...DATABASE_SIDECARS.map((suffix) => move.databaseName + suffix)]
    : [];
  try {
    mkdirSync(move.to, { recursive: true });
    for (const name of readdirSync(move.from)) {
      if (sqliteFiles.includes(name) || existsSync(join(move.to, name))) {
        continue;
      }
      cpSync(join(move.from, name), join(move.to, name), { recursive: true });
    }
    if (move.databaseName && existsSync(join(move.from, move.databaseName))) {
      const source = new DatabaseSync(join(move.from, move.databaseName), { readOnly: true });
      try {
        source.prepare('VACUUM INTO ?').run(join(move.to, move.databaseName));
      } finally {
        source.close();
      }
    }
  } catch (error) {
    return { kind: 'failed', reason: `${reason}; copy failed: ${errorMessage(error)}` };
  }
  writeNote(move.from, [
    'PostPile (formerly code-manager) copied this folder to:',
    `  ${move.to}`,
    `Why a copy and not a move: ${reason}.`,
    'The app now reads the new folder. Changes made here after the copy are not carried over.',
    'Delete this folder once PostPile works.',
  ]);
  return { kind: 'copied', reason };
}

/** Moves one legacy folder to its new place, see MigrationOutcome. */
export function migrateLegacyDir(move: LegacyDirMove): MigrationOutcome {
  if (!existsSync(move.from) || existsSync(join(move.to, move.marker))) {
    return { kind: 'nothing' };
  }
  if (move.databaseName) {
    const lock = databaseLockState(join(move.from, move.databaseName));
    if (lock === 'busy') {
      return copyInto(move, 'another process had the database open');
    }
    if (lock === 'unknown') {
      return copyInto(move, 'could not tell whether another process had the database open');
    }
  }
  try {
    if (!existsSync(move.to)) {
      mkdirSync(dirname(move.to), { recursive: true });
      renameSync(move.from, move.to);
      return { kind: 'moved' };
    }
    const left = mergeInto(move.from, move.to);
    if (left.length > 0) {
      writeNote(move.from, [
        'PostPile (formerly code-manager) moved this folder to:',
        `  ${move.to}`,
        `These entries already existed there and stayed here: ${left.join(', ')}.`,
      ]);
    }
    return { kind: 'merged', left };
  } catch (error) {
    // E.g. EXDEV (another volume) or a permission problem: fall back to a copy.
    return copyInto(move, `move failed (${errorMessage(error)})`);
  }
}

function outcomeLine(label: string, move: LegacyDirMove, outcome: MigrationOutcome): string | null {
  switch (outcome.kind) {
    case 'nothing':
      return null;
    case 'moved':
      return `${label}: moved ${move.from} -> ${move.to}`;
    case 'merged':
      return outcome.left.length > 0
        ? `${label}: moved ${move.from} -> ${move.to}, left behind: ${outcome.left.join(', ')}`
        : `${label}: moved ${move.from} -> ${move.to}`;
    case 'copied':
      return `${label}: copied ${move.from} -> ${move.to} (${outcome.reason}), old folder kept with a note`;
    case 'failed':
      return `${label}: could not migrate ${move.from} -> ${move.to}: ${outcome.reason}`;
  }
}

/**
 * Brings the code-manager data and config folders over to PostPile. Skips a
 * folder whose path is overridden (POSTPILE_DB, POSTPILE_INSTRUCTIONS), so
 * runs against a scratch database never touch the real folders.
 */
export function migrateLegacyData(pathEnv: PathEnv = systemPathEnv(), log: (line: string) => void = console.log): void {
  // Only the real (packaged) location ever takes the old data; dev runs leave it alone.
  if (profileFromEnv(pathEnv.env) === 'dev') {
    return;
  }
  const oldDirs = legacyDataDirs(pathEnv);
  const newDirs = realDataDirs(pathEnv);
  const moves: Array<{ label: string; move: LegacyDirMove; overridden: boolean }> = [
    {
      label: 'data',
      move: { from: oldDirs.dataDir, to: newDirs.dataDir, marker: DATABASE_FILE_NAME, databaseName: DATABASE_FILE_NAME },
      overridden: Boolean(pathEnv.env.POSTPILE_DB || pathEnv.env.POSTPILE_DATA_DIR),
    },
    {
      label: 'config',
      move: { from: oldDirs.configDir, to: newDirs.configDir, marker: 'instructions.md' },
      overridden: Boolean(pathEnv.env.POSTPILE_INSTRUCTIONS),
    },
  ];
  for (const { label, move, overridden } of moves) {
    if (overridden) {
      continue;
    }
    const line = outcomeLine(label, move, migrateLegacyDir(move));
    if (line) {
      log(`PostPile migration, ${line}`);
    }
  }
}

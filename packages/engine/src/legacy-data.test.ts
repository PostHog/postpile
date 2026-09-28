import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateLegacyData, migrateLegacyDir, type LegacyDirMove } from './legacy-data.ts';

const NOTE = 'README-moved-to-postpile.txt';

let root: string;

function makeDatabase(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, 'db.sqlite'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('CREATE TABLE t (v TEXT)');
  db.exec("INSERT INTO t VALUES ('kept')");
  db.close();
}

function readValue(dir: string): string {
  const db = new DatabaseSync(join(dir, 'db.sqlite'), { readOnly: true });
  try {
    const row = db.prepare('SELECT v FROM t').get() as { v: string };
    return row.v;
  } finally {
    db.close();
  }
}

function dataMove(): LegacyDirMove {
  return {
    from: join(root, 'old'),
    to: join(root, 'new'),
    marker: 'db.sqlite',
    databaseName: 'db.sqlite',
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'postpile-migrate-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('migrateLegacyDir', () => {
  it('does nothing without an old folder', () => {
    expect(migrateLegacyDir(dataMove())).toEqual({ kind: 'nothing' });
    expect(existsSync(join(root, 'new'))).toBe(false);
  });

  it('renames the whole folder; rows still in the -wal file survive', () => {
    const move = dataMove();
    // A crash leaves rows in db.sqlite-wal that are not in db.sqlite yet:
    // copy the three files while a connection holds them uncheckpointed.
    makeDatabase(join(root, 'live'));
    const live = new DatabaseSync(join(root, 'live', 'db.sqlite'));
    live.exec('PRAGMA wal_autocheckpoint = 0');
    live.exec("UPDATE t SET v = 'from-wal'");
    mkdirSync(move.from);
    for (const name of ['db.sqlite', 'db.sqlite-wal', 'db.sqlite-shm']) {
      copyFileSync(join(root, 'live', name), join(move.from, name));
    }
    live.close();
    writeFileSync(join(move.from, 'other.txt'), 'x');

    expect(migrateLegacyDir(move)).toEqual({ kind: 'moved' });

    expect(existsSync(move.from)).toBe(false);
    expect(readdirSync(move.to)).toContain('other.txt');
    expect(readValue(move.to)).toBe('from-wal');
  });

  it('leaves both folders alone once the new one has a database', () => {
    const move = dataMove();
    makeDatabase(move.from);
    mkdirSync(move.to);
    writeFileSync(join(move.to, 'db.sqlite'), '');

    expect(migrateLegacyDir(move)).toEqual({ kind: 'nothing' });
    expect(readValue(move.from)).toBe('kept');
  });

  it('merges into a new folder that exists without a database', () => {
    const move = dataMove();
    makeDatabase(move.from);
    mkdirSync(join(move.from, 'Local Storage'));
    mkdirSync(join(move.to, 'Local Storage'), { recursive: true });

    expect(migrateLegacyDir(move)).toEqual({ kind: 'merged', left: ['Local Storage'] });

    expect(readValue(move.to)).toBe('kept');
    expect(existsSync(join(move.from, 'db.sqlite'))).toBe(false);
    expect(readFileSync(join(move.from, NOTE), 'utf8')).toContain('Local Storage');
  });

  it('removes the old folder when the merge moved everything', () => {
    const move = dataMove();
    makeDatabase(move.from);
    mkdirSync(move.to);

    expect(migrateLegacyDir(move)).toEqual({ kind: 'merged', left: [] });
    expect(existsSync(move.from)).toBe(false);
  });

  it('copies and keeps the old folder while another connection holds the database', () => {
    const move = dataMove();
    makeDatabase(move.from);
    writeFileSync(join(move.from, 'other.txt'), 'x');
    const holder = new DatabaseSync(join(move.from, 'db.sqlite'));
    holder.exec('PRAGMA journal_mode = WAL');
    holder.exec("INSERT INTO t VALUES ('later')");
    try {
      const outcome = migrateLegacyDir(move);
      expect(outcome).toEqual({ kind: 'copied', reason: 'another process had the database open' });
    } finally {
      holder.close();
    }

    expect(readValue(move.from)).toBe('kept');
    expect(readValue(move.to)).toBe('kept');
    expect(readFileSync(join(move.to, 'other.txt'), 'utf8')).toBe('x');
    expect(readFileSync(join(move.from, NOTE), 'utf8')).toContain(move.to);
  });

  it('moves a folder without a database, like the config folder', () => {
    const move: LegacyDirMove = { from: join(root, 'cfg-old'), to: join(root, 'cfg', 'new'), marker: 'instructions.md' };
    mkdirSync(move.from);
    writeFileSync(join(move.from, 'instructions.md'), 'be brief');

    expect(migrateLegacyDir(move)).toEqual({ kind: 'moved' });
    expect(readFileSync(join(move.to, 'instructions.md'), 'utf8')).toBe('be brief');
  });
});

describe('migrateLegacyData', () => {
  it('moves the macOS data folder and the config folder and logs both', () => {
    const home = join(root, 'home');
    const oldData = join(home, 'Library', 'Application Support', 'code-manager');
    makeDatabase(oldData);
    mkdirSync(join(home, '.config', 'code-manager'), { recursive: true });
    writeFileSync(join(home, '.config', 'code-manager', 'instructions.md'), 'be brief');
    const lines: string[] = [];

    migrateLegacyData({ env: {}, platform: 'darwin', home }, (line) => lines.push(line));

    expect(readValue(join(home, 'Library', 'Application Support', 'PostPile'))).toBe('kept');
    expect(readFileSync(join(home, '.config', 'postpile', 'instructions.md'), 'utf8')).toBe('be brief');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('data: moved');
    expect(lines[1]).toContain('config: moved');
  });

  it('uses the XDG data folder elsewhere', () => {
    const home = join(root, 'home');
    makeDatabase(join(root, 'xdg', 'code-manager'));

    migrateLegacyData({ env: { XDG_DATA_HOME: join(root, 'xdg') }, platform: 'linux', home }, () => {});

    expect(readValue(join(root, 'xdg', 'postpile'))).toBe('kept');
  });

  it('skips folders whose path is overridden and logs nothing without old data', () => {
    const home = join(root, 'home');
    const oldData = join(home, 'Library', 'Application Support', 'code-manager');
    makeDatabase(oldData);
    const lines: string[] = [];

    migrateLegacyData({ env: { POSTPILE_DB: join(root, 'x.sqlite') }, platform: 'darwin', home }, (line) => lines.push(line));

    expect(readValue(oldData)).toBe('kept');
    expect(lines).toEqual([]);
  });
});

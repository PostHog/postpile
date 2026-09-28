import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileLog, logDirFromEnv } from './file-log.ts';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'postpile-log-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('FileLog', () => {
  it('appends lines with time and level', () => {
    const log = new FileLog(join(tempDir(), 'logs'));
    log.write('warn', 'gh not found');
    expect(readFileSync(log.file, 'utf8')).toMatch(/^\d{4}-\d{2}-\d{2}T.+ \[warn\] gh not found\n$/);
  });

  it('rotates past the size limit and keeps three files', () => {
    const dir = tempDir();
    const log = new FileLog(dir, 100);
    for (let n = 0; n < 12; n += 1) {
      log.write('log', `line ${n} ${'x'.repeat(40)}`);
    }
    expect(readdirSync(dir).sort()).toEqual(['main.1.log', 'main.2.log', 'main.log']);
    expect(readFileSync(log.file, 'utf8')).toContain('line 11');
    expect(existsSync(join(dir, 'main.3.log'))).toBe(false);
  });
});

describe('logDirFromEnv', () => {
  it('uses ~/Library/Logs/PostPile, PostPile-dev for dev runs, and POSTPILE_LOG_DIR over both', () => {
    expect(logDirFromEnv(false, {}, '/Users/j')).toBe('/Users/j/Library/Logs/PostPile');
    expect(logDirFromEnv(true, {}, '/Users/j')).toBe('/Users/j/Library/Logs/PostPile-dev');
    expect(logDirFromEnv(true, { POSTPILE_LOG_DIR: '/tmp/x' }, '/Users/j')).toBe('/tmp/x');
  });
});

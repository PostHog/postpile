import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { serverToken } from './server-token.ts';

const dirs: string[] = [];

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'postpile-token-'));
  dirs.push(dir);
  return join(dir, 'data', 'server-token');
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('serverToken', () => {
  it('keeps one token across restarts, readable only by the user', () => {
    const file = tempFile();
    const first = serverToken({}, file);
    expect(first).toMatch(/^[0-9a-f]{48}$/);
    expect(serverToken({}, file)).toBe(first);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('prefers POSTPILE_TOKEN and writes nothing for it', () => {
    const file = tempFile();
    expect(serverToken({ POSTPILE_TOKEN: 'given' }, file)).toBe('given');
    expect(() => readFileSync(file)).toThrow();
  });

  it('replaces a stored token that is too short, and makes a fresh one without a file', () => {
    const file = tempFile();
    serverToken({}, file);
    writeFileSync(file, 'short\n');
    expect(serverToken({}, file)).toMatch(/^[0-9a-f]{48}$/);
    expect(serverToken({}, null)).not.toBe(serverToken({}, null));
  });
});


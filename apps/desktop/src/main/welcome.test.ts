import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WELCOME_FLAG_FILE, welcomeOnce } from './welcome.ts';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'postpile-welcome-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('welcomeOnce', () => {
  it('shows the welcome once and remembers it', () => {
    const dir = tempDir();
    let shown = 0;
    const show = () => {
      shown += 1;
      return 'shown' as const;
    };
    expect(welcomeOnce(dir, show)).toBe(true);
    expect(welcomeOnce(dir, show)).toBe(false);
    expect(shown).toBe(1);
    expect(existsSync(join(dir, WELCOME_FLAG_FILE))).toBe(true);
  });

  it('keeps it for later while notifications are off', () => {
    const dir = tempDir();
    expect(welcomeOnce(dir, () => 'off')).toBe(false);
    expect(existsSync(join(dir, WELCOME_FLAG_FILE))).toBe(false);
  });
});

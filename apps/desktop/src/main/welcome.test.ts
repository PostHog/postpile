import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { firstLaunchOnce, LAUNCHED_FLAG_FILE, WELCOME_FLAG_FILE, welcomeOnce } from './welcome.ts';

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

describe('firstLaunchOnce', () => {
  it('says first launch once', () => {
    const dir = tempDir();
    expect(firstLaunchOnce(dir)).toBe(true);
    expect(firstLaunchOnce(dir)).toBe(false);
    expect(existsSync(join(dir, LAUNCHED_FLAG_FILE))).toBe(true);
  });

  it('counts an install from before 0.18, which only has the welcome flag, as launched', () => {
    const dir = tempDir();
    writeFileSync(join(dir, WELCOME_FLAG_FILE), '{}\n');
    expect(firstLaunchOnce(dir)).toBe(false);
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEngine, writesOnByDefault } from './create.ts';
import type { LockKind } from './data-lock.ts';

const dirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A fresh database in a temp folder: no `github_writes` choice stored, like an install that never touched the lock. */
function freshPaths(): { databaseFile: string; instructionsFile: string } {
  const dir = mkdtempSync(join(tmpdir(), 'postpile-writes-default-'));
  dirs.push(dir);
  return { databaseFile: join(dir, 'db.sqlite'), instructionsFile: join(dir, 'instructions.md') };
}

async function writesOn(lockKind: LockKind): Promise<boolean> {
  const engine = createEngine({ paths: freshPaths(), lockKind });
  try {
    return (await engine.githubWrites()).enabled;
  } finally {
    await engine.close();
  }
}

describe('writesOnByDefault', () => {
  it('is on only in the packaged app on the default profile', () => {
    expect(writesOnByDefault('packaged', {})).toBe(true);
    expect(writesOnByDefault('packaged', { POSTPILE_PROFILE: 'default' })).toBe(true);
    expect(writesOnByDefault('packaged', { POSTPILE_PROFILE: 'dev' })).toBe(false);
    expect(writesOnByDefault('dev', {})).toBe(false);
    expect(writesOnByDefault('server', {})).toBe(false);
    expect(writesOnByDefault('cli', {})).toBe(false);
  });
});

describe('a dev session never writes because of the default', () => {
  it.each<[string, LockKind]>([
    ['the unpackaged desktop app (pnpm desktop)', 'dev'],
    ['pnpm server', 'server'],
    ['pnpm cli', 'cli'],
    ['a packaged build on the dev profile', 'packaged'],
  ])('%s starts with writes locked', async (_name, lockKind) => {
    vi.stubEnv('POSTPILE_PROFILE', 'dev');
    expect(await writesOn(lockKind)).toBe(false);
  });

  it('a dev entry point run on the default profile stays locked too', async () => {
    vi.stubEnv('POSTPILE_PROFILE', 'default');
    expect(await writesOn('dev')).toBe(false);
    expect(await writesOn('cli')).toBe(false);
    expect(await writesOn('server')).toBe(false);
  });

  it('only the packaged app on the default profile starts with writes on, and POSTPILE_READ_ONLY=1 still wins', async () => {
    vi.stubEnv('POSTPILE_PROFILE', 'default');
    expect(await writesOn('packaged')).toBe(true);
    vi.stubEnv('POSTPILE_READ_ONLY', '1');
    expect(await writesOn('packaged')).toBe(false);
  });
});

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadOrCreateInstallId } from './install-id.ts';

describe('loadOrCreateInstallId', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates a file the first time and reuses it after', () => {
    const dir = mkdtempSync(join(tmpdir(), 'postpile-telemetry-'));
    dirs.push(dir);
    const file = join(dir, 'config', 'telemetry-id');

    const first = loadOrCreateInstallId(file);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(readFileSync(file, 'utf8')).toBe(first);
    expect(loadOrCreateInstallId(file)).toBe(first);
  });

  it('makes a fresh id every call without a file (tests, no-lock reads)', () => {
    expect(loadOrCreateInstallId(undefined)).not.toBe(loadOrCreateInstallId(undefined));
  });
});

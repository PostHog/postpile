import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RUN_MARKER_FILE, RunMarker } from './run-marker.ts';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'postpile-run-marker-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('RunMarker', () => {
  it('reports nothing on a first launch and marks the run', () => {
    const dir = tempDir();
    const now = new Date('2026-10-05T09:00:00Z');

    expect(new RunMarker(dir).start('0.18.0', now, 4242)).toBeNull();

    const marker = JSON.parse(readFileSync(join(dir, RUN_MARKER_FILE), 'utf8')) as unknown;
    expect(marker).toEqual({ pid: 4242, version: '0.18.0', startedAt: '2026-10-05T09:00:00.000Z' });
  });

  it('reports nothing after a clean quit', () => {
    const dir = tempDir();
    const first = new RunMarker(dir);
    first.start('0.18.0');
    first.clear();
    expect(existsSync(join(dir, RUN_MARKER_FILE))).toBe(false);

    expect(new RunMarker(dir).start('0.18.0')).toBeNull();
  });

  it('reports a run that never quit cleanly, and marks the new run', () => {
    const dir = tempDir();
    new RunMarker(dir).start('0.18.0', new Date('2026-10-05T09:00:00Z'), 100);

    expect(new RunMarker(dir).start('0.18.0', new Date('2026-10-05T10:00:00Z'), 200)).toEqual({ versionChanged: false });

    const marker = JSON.parse(readFileSync(join(dir, RUN_MARKER_FILE), 'utf8')) as { pid: number };
    expect(marker.pid).toBe(200);
  });

  it('says when the run that went down was another version', () => {
    const dir = tempDir();
    new RunMarker(dir).start('0.17.0');

    expect(new RunMarker(dir).start('0.18.0')).toEqual({ versionChanged: true });
  });

  it('counts a marker it cannot read as unclean, without a version change', () => {
    const dir = tempDir();
    writeFileSync(join(dir, RUN_MARKER_FILE), '{"pid": 12');

    expect(new RunMarker(dir).start('0.18.0')).toEqual({ versionChanged: false });
  });

  it('leaves the marker of another run alone when it never wrote one', () => {
    const dir = tempDir();
    new RunMarker(dir).start('0.18.0');

    new RunMarker(dir).clear();

    expect(existsSync(join(dir, RUN_MARKER_FILE))).toBe(true);
  });
});

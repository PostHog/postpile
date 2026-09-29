import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrateLegacyData } from './legacy-data.ts';
import { applyLegacyEnv, defaultPaths, profileFromEnv, seedDevInstructions } from './paths.ts';

describe('defaultPaths', () => {
  it('uses Application Support on macOS', () => {
    const paths = defaultPaths({ env: {}, platform: 'darwin', home: '/Users/me' });
    expect(paths.databaseFile).toBe('/Users/me/Library/Application Support/PostPile/db.sqlite');
    expect(paths.instructionsFile).toBe('/Users/me/.config/postpile/instructions.md');
    expect(paths.telemetryIdFile).toBe('/Users/me/.config/postpile/telemetry-id');
  });

  it('honours XDG dirs elsewhere', () => {
    const paths = defaultPaths({
      env: { XDG_CONFIG_HOME: '/cfg', XDG_DATA_HOME: '/data' },
      platform: 'linux',
      home: '/home/me',
    });
    expect(paths.instructionsFile).toBe('/cfg/postpile/instructions.md');
    expect(paths.databaseFile).toBe('/data/postpile/db.sqlite');
  });

  it('lets env vars override both files', () => {
    const paths = defaultPaths({
      env: { POSTPILE_DB: '/tmp/x.sqlite', POSTPILE_INSTRUCTIONS: '/tmp/i.md' },
      platform: 'darwin',
      home: '/Users/me',
    });
    expect(paths.databaseFile).toBe('/tmp/x.sqlite');
    expect(paths.instructionsFile).toBe('/tmp/i.md');
  });
});

describe('dev profile', () => {
  const dev = { POSTPILE_PROFILE: 'dev' };

  it('uses separate dev folders', () => {
    const paths = defaultPaths({ env: dev, platform: 'darwin', home: '/Users/me' });
    expect(paths.databaseFile).toBe('/Users/me/Library/Application Support/PostPile-dev/db.sqlite');
    expect(paths.instructionsFile).toBe('/Users/me/.config/postpile-dev/instructions.md');
    expect(profileFromEnv(dev)).toBe('dev');
    expect(profileFromEnv({})).toBe('default');
  });

  it('lets POSTPILE_DATA_DIR and POSTPILE_DB override it', () => {
    expect(defaultPaths({ env: { ...dev, POSTPILE_DATA_DIR: '/d' }, platform: 'darwin', home: '/Users/me' }).databaseFile).toBe('/d/db.sqlite');
    expect(defaultPaths({ env: { ...dev, POSTPILE_DATA_DIR: '/d', POSTPILE_DB: '/x.sqlite' }, platform: 'darwin', home: '/Users/me' }).databaseFile).toBe('/x.sqlite');
  });

  it('copies the real instructions once, when the dev config folder is new', () => {
    const home = mkdtempSync(join(tmpdir(), 'postpile-home-'));
    try {
      mkdirSync(join(home, '.config', 'postpile'), { recursive: true });
      writeFileSync(join(home, '.config', 'postpile', 'instructions.md'), 'real rules');
      const pathEnv = { env: dev, platform: 'darwin' as const, home };
      const devFile = join(home, '.config', 'postpile-dev', 'instructions.md');

      expect(seedDevInstructions(pathEnv)).toBe(devFile);
      expect(readFileSync(devFile, 'utf8')).toBe('real rules');
      writeFileSync(devFile, 'dev edit');
      expect(seedDevInstructions(pathEnv)).toBeNull();
      expect(readFileSync(devFile, 'utf8')).toBe('dev edit');
      expect(seedDevInstructions({ ...pathEnv, env: {} })).toBeNull();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('never runs the code-manager move in dev', () => {
    const home = mkdtempSync(join(tmpdir(), 'postpile-home-'));
    try {
      const old = join(home, 'Library', 'Application Support', 'code-manager');
      mkdirSync(old, { recursive: true });
      writeFileSync(join(old, 'db.sqlite'), '');
      migrateLegacyData({ env: { POSTPILE_PROFILE: 'dev' }, platform: 'darwin', home }, () => {});
      expect(existsSync(join(old, 'db.sqlite'))).toBe(true);
      expect(existsSync(join(home, 'Library', 'Application Support', 'PostPile-dev'))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('applyLegacyEnv', () => {
  it('copies old CODE_MANAGER_* names over unless the new one is set, and warns once', () => {
    const env: NodeJS.ProcessEnv = { CODE_MANAGER_FAKE: '1', CODE_MANAGER_DB: '/old.sqlite', POSTPILE_DB: '/new.sqlite' };
    const lines: string[] = [];

    expect(applyLegacyEnv(env, (line) => lines.push(line))).toEqual(['CODE_MANAGER_FAKE']);
    expect(env.POSTPILE_FAKE).toBe('1');
    expect(env.POSTPILE_DB).toBe('/new.sqlite');
    expect(lines).toEqual(['deprecated: CODE_MANAGER_FAKE still work for now, rename them to POSTPILE_*']);

    applyLegacyEnv({ CODE_MANAGER_MODEL: 'opus' }, (line) => lines.push(line));
    expect(lines).toHaveLength(1);
  });
});

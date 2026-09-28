import { describe, expect, it } from 'vitest';
import { applyLegacyEnv, defaultPaths } from './paths.ts';

describe('defaultPaths', () => {
  it('uses Application Support on macOS', () => {
    const paths = defaultPaths({ env: {}, platform: 'darwin', home: '/Users/me' });
    expect(paths.databaseFile).toBe('/Users/me/Library/Application Support/PostPile/db.sqlite');
    expect(paths.instructionsFile).toBe('/Users/me/.config/postpile/instructions.md');
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

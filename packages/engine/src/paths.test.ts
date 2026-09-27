import { describe, expect, it } from 'vitest';
import { defaultPaths } from './paths.ts';

describe('defaultPaths', () => {
  it('uses Application Support on macOS', () => {
    const paths = defaultPaths({ env: {}, platform: 'darwin', home: '/Users/me' });
    expect(paths.databaseFile).toBe('/Users/me/Library/Application Support/code-manager/db.sqlite');
    expect(paths.instructionsFile).toBe('/Users/me/.config/code-manager/instructions.md');
  });

  it('honours XDG dirs elsewhere', () => {
    const paths = defaultPaths({
      env: { XDG_CONFIG_HOME: '/cfg', XDG_DATA_HOME: '/data' },
      platform: 'linux',
      home: '/home/me',
    });
    expect(paths.instructionsFile).toBe('/cfg/code-manager/instructions.md');
    expect(paths.databaseFile).toBe('/data/code-manager/db.sqlite');
  });

  it('lets env vars override both files', () => {
    const paths = defaultPaths({
      env: { CODE_MANAGER_DB: '/tmp/x.sqlite', CODE_MANAGER_INSTRUCTIONS: '/tmp/i.md' },
      platform: 'darwin',
      home: '/Users/me',
    });
    expect(paths.databaseFile).toBe('/tmp/x.sqlite');
    expect(paths.instructionsFile).toBe('/tmp/i.md');
  });
});

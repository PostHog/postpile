import { describe, expect, it } from 'vitest';
import { defaultPaths } from './index.ts';

describe('defaultPaths', () => {
  it('honours XDG dirs and the database override', () => {
    const paths = defaultPaths({ XDG_CONFIG_HOME: '/cfg', XDG_DATA_HOME: '/data' });
    expect(paths.instructionsFile).toBe('/cfg/code-manager/instructions.md');
    expect(paths.databaseFile).toBe('/data/code-manager/code-manager.db');
    expect(defaultPaths({ CODE_MANAGER_DB: '/tmp/x.db' }).databaseFile).toBe('/tmp/x.db');
  });
});

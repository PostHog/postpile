import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultPaths } from './paths.ts';
import { UserConfigFile } from './user-config.ts';
import { resolveSweepSkip } from './work-context/skip-list.ts';

const dirs: string[] = [];

function tempConfig(text?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'postpile-config-'));
  dirs.push(dir);
  const path = join(dir, 'postpile', 'config.json');
  if (text !== undefined) {
    writeFileSync(join(dir, 'config.json'), text);
    return join(dir, 'config.json');
  }
  return path;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('UserConfigFile', () => {
  it('reads sweepSkip, trimmed', () => {
    const file = new UserConfigFile(tempConfig('{ "sweepSkip": [" taxes ", "side-project", ""] }'));
    expect(file.read()).toEqual({ sweepSkip: ['taxes', 'side-project'] });
  });

  it('reads toolPath next to sweepSkip and ignores a toolPath that is not a list of strings', () => {
    expect(new UserConfigFile(tempConfig('{ "toolPath": ["~/.local/share/mise/shims", " "] }')).read()).toEqual({ toolPath: ['~/.local/share/mise/shims'] });
    const logs: string[] = [];
    const file = new UserConfigFile(tempConfig('{ "sweepSkip": ["taxes"], "toolPath": "/opt/bin" }'), (line) => logs.push(line));
    expect(file.read()).toEqual({ sweepSkip: ['taxes'] });
    expect(logs).toEqual([expect.stringContaining('ignoring toolPath')]);
  });

  it('treats a missing file as empty and a broken one as empty, logged', () => {
    const logs: string[] = [];
    expect(new UserConfigFile(tempConfig()).read()).toEqual({});
    expect(new UserConfigFile(tempConfig('{ nope'), (line) => logs.push(line)).read()).toEqual({});
    expect(new UserConfigFile(tempConfig('{ "sweepSkip": "taxes" }'), (line) => logs.push(line)).read()).toEqual({});
    expect(logs).toHaveLength(2);
  });

  it('writes the skip list, creating the folder and keeping other keys', () => {
    const missing = new UserConfigFile(tempConfig());
    missing.setSweepSkip(['taxes', ' side-project ']);
    expect(JSON.parse(readFileSync(missing.path, 'utf8'))).toEqual({ sweepSkip: ['taxes', 'side-project'] });

    const existing = new UserConfigFile(tempConfig('{ "other": 1, "sweepSkip": ["old"] }'));
    existing.setSweepSkip([]);
    expect(JSON.parse(readFileSync(existing.path, 'utf8'))).toEqual({ other: 1, sweepSkip: [] });
  });

  it('refuses to overwrite a file it cannot parse', () => {
    const broken = new UserConfigFile(tempConfig('{ nope'), () => {});
    expect(() => broken.setSweepSkip(['taxes'])).toThrow();
    expect(readFileSync(broken.path, 'utf8')).toBe('{ nope');
  });
});

describe('resolveSweepSkip', () => {
  it('takes the env var, then the config file, then the defaults', () => {
    expect(resolveSweepSkip('a, b', ['c'])).toEqual({ patterns: ['a', 'b'], source: 'env' });
    expect(resolveSweepSkip('', ['c'])).toEqual({ patterns: [], source: 'env' });
    expect(resolveSweepSkip(undefined, ['c'])).toEqual({ patterns: ['c'], source: 'config' });
    expect(resolveSweepSkip(undefined, [])).toEqual({ patterns: [], source: 'config' });
    expect(resolveSweepSkip(undefined, undefined)).toMatchObject({ source: 'default' });
  });
});

describe('defaultPaths', () => {
  it('puts config.json next to instructions.md, per profile', () => {
    const base = { platform: 'darwin' as const, home: '/Users/sample' };
    expect(defaultPaths({ ...base, env: {} }).configFile).toBe('/Users/sample/.config/postpile/config.json');
    expect(defaultPaths({ ...base, env: { POSTPILE_PROFILE: 'dev' } }).configFile).toBe('/Users/sample/.config/postpile-dev/config.json');
  });
});

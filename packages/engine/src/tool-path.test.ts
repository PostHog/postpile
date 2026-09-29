import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { launchToolPath, systemPathDirs } from './tool-path.ts';

const dirs: string[] = [];

/** A fake /etc with paths and paths.d, plus a config.json next to it. */
function fakeEtc(): { etcDir: string; configFile: string } {
  const dir = mkdtempSync(join(tmpdir(), 'postpile-etc-'));
  dirs.push(dir);
  const etcDir = join(dir, 'etc');
  mkdirSync(join(etcDir, 'paths.d'), { recursive: true });
  writeFileSync(join(etcDir, 'paths'), '/usr/local/bin\n/usr/bin\n/bin\n');
  writeFileSync(join(etcDir, 'paths.d', '20-tex'), '/Library/TeX/texbin\n');
  writeFileSync(join(etcDir, 'paths.d', '10-cryptex'), '/System/Cryptexes/App/usr/bin\n');
  return { etcDir, configFile: join(dir, 'config.json') };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('systemPathDirs', () => {
  it('reads /etc/paths, then /etc/paths.d in name order', () => {
    const { etcDir } = fakeEtc();
    expect(systemPathDirs(etcDir)).toEqual(['/usr/local/bin', '/usr/bin', '/bin', '/System/Cryptexes/App/usr/bin', '/Library/TeX/texbin']);
  });

  it('gives nothing when the files are missing', () => {
    expect(systemPathDirs('/nonexistent/etc')).toEqual([]);
  });
});

describe('launchToolPath', () => {
  it('puts toolPath from config.json first, without running a shell', () => {
    const { etcDir, configFile } = fakeEtc();
    writeFileSync(configFile, '{ "toolPath": ["~/.local/share/mise/shims"] }');
    const path = launchToolPath({ envPath: '/usr/bin:/bin:/usr/sbin:/sbin', home: '/Users/alice', configFile, etcDir });
    expect(path.split(':')).toEqual([
      '/Users/alice/.local/share/mise/shims',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
      '/usr/local/bin',
      '/System/Cryptexes/App/usr/bin',
      '/Library/TeX/texbin',
      '/opt/homebrew/bin',
      '/Users/alice/.local/bin',
      '/Users/alice/.claude/local',
    ]);
  });

  it('works without a config.json', () => {
    const { etcDir, configFile } = fakeEtc();
    expect(launchToolPath({ envPath: '', home: '/h', configFile, etcDir }).split(':')[0]).toBe('/usr/local/bin');
  });
});

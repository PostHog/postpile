import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The desktop version is what the app, the zip name and the Homebrew cask show,
// and the release workflow checks the tag against it. The other packages carry
// the same version so the repo has one version, not nine.
const root = join(import.meta.dirname, '../../../..');

function packageFiles(): string[] {
  const workspaces = ['apps', 'packages'].flatMap((folder) =>
    readdirSync(join(root, folder), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(folder, entry.name, 'package.json')),
  );
  return ['package.json', ...workspaces];
}

function versionOf(file: string): string {
  return (JSON.parse(readFileSync(join(root, file), 'utf8')) as { version: string }).version;
}

describe('package versions', () => {
  it('are the same in the root and every workspace package', () => {
    const rootVersion = versionOf('package.json');
    for (const file of packageFiles()) {
      expect({ file, version: versionOf(file) }).toEqual({ file, version: rootVersion });
    }
  });
});

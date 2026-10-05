import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Main keeps Electron's default crashDumps folder (Crashpad/ in userData,
// docs/development.md). app.setPath wants the folder to exist, and on a
// fresh install nothing has made it yet, so moving it can stop the app at
// start (found by Codex review on #115). A plain text search over main.
const mainSource = readFileSync(join(import.meta.dirname, 'index.ts'), 'utf8');

describe('crash dumps', () => {
  it('starts the crash reporter without uploads', () => {
    expect(mainSource).toContain('crashReporter.start({ uploadToServer: false })');
  });

  it('never moves the crash dump folder', () => {
    expect(mainSource).not.toMatch(/setPath\(\s*['"]crashDumps['"]/);
  });
});

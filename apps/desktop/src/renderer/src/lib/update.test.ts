import { describe, expect, it } from 'vitest';
import { behindSinceDate, releaseDate, releasesBehindText, upgradeSteps } from './update.ts';

describe('update reminder text', () => {
  it('formats the release date', () => {
    expect(releaseDate('2026-09-29T12:00:00Z')).toBe('Sep 29, 2026');
    expect(releaseDate(null)).toBe('');
    expect(releaseDate('soon')).toBe('');
  });

  it('formats the day the user fell behind', () => {
    expect(behindSinceDate('2026-09-29T12:00:00Z')).toBe('Tue, Sep 29');
    expect(behindSinceDate(null)).toBe('');
  });

  it('words the release count', () => {
    expect(releasesBehindText(1, false)).toBe('1 release');
    expect(releasesBehindText(3, false)).toBe('3 releases');
    expect(releasesBehindText(10, true)).toBe('10+ releases');
  });

  it('names the upgrade steps for the way PostPile was installed', () => {
    expect(upgradeSteps('app')).toEqual({ command: 'brew upgrade --cask postpile', afterwards: 'Then quit and reopen PostPile.' });
    expect(upgradeSteps('app-browser').command).toBe('brew upgrade --cask postpile && postpile browser --restart');
    expect(upgradeSteps('source').afterwards).toBe('Then restart pnpm server and reload this page.');
  });
});

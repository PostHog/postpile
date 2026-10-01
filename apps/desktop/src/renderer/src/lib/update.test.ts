import { describe, expect, it } from 'vitest';
import { behindSinceDate, releaseDate, releasesBehindText } from './update.ts';

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
});

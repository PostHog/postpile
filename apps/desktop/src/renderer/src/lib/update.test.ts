import { describe, expect, it } from 'vitest';
import type { UpdateView } from '@postpile/core';
import { laterKey, pillVersion, releaseDate } from './update.ts';

const view: UpdateView = {
  current: '0.1.0-alpha.0',
  latest: { version: '0.1.0-alpha.1', url: 'https://github.com/acme/app/releases/tag/v0.1.0-alpha.1', publishedAt: '2026-09-29T12:00:00Z', notes: '' },
  checkedAt: '2026-09-29T12:30:00Z',
  error: null,
};

describe('update pill', () => {
  it('shows the new version until the user says Later to it', () => {
    expect(pillVersion(view, new Set())).toBe('0.1.0-alpha.1');
    expect(pillVersion(view, new Set(['0.1.0-alpha.1']))).toBeNull();
    expect(pillVersion(view, new Set(['0.1.0-alpha.0']))).toBe('0.1.0-alpha.1');
  });

  it('shows nothing without an update', () => {
    expect(pillVersion(undefined, new Set())).toBeNull();
    expect(pillVersion({ ...view, latest: null }, new Set())).toBeNull();
  });

  it('keeps Later per version', () => {
    expect(laterKey('0.1.0-alpha.1')).toBe('postpile.update.later.0.1.0-alpha.1');
  });

  it('formats the release date', () => {
    expect(releaseDate('2026-09-29T12:00:00Z')).toBe('Sep 29, 2026');
    expect(releaseDate(null)).toBe('');
    expect(releaseDate('soon')).toBe('');
  });
});

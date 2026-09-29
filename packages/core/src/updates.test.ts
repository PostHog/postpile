import { describe, expect, it } from 'vitest';
import { compareVersions, isVersion, pickUpdate, type ReleaseInfo } from './index.ts';

function release(tag: string, overrides: Partial<ReleaseInfo> = {}): ReleaseInfo {
  return {
    tag,
    url: `https://github.com/acme/app/releases/tag/${tag}`,
    publishedAt: '2026-09-28T10:00:00Z',
    notes: '',
    draft: false,
    ...overrides,
  };
}

describe('compareVersions', () => {
  it('orders pre-releases before their release', () => {
    const ordered = ['0.1.0-alpha.0', '0.1.0-alpha.1', '0.1.0-alpha.10', '0.1.0-beta.0', '0.1.0-rc.1', '0.1.0', '0.1.1', '0.2.0', '1.0.0'];
    for (let index = 1; index < ordered.length; index++) {
      expect(compareVersions(ordered[index - 1]!, ordered[index]!)).toBe(-1);
      expect(compareVersions(ordered[index]!, ordered[index - 1]!)).toBe(1);
    }
  });

  it('ignores a leading v and build metadata', () => {
    expect(compareVersions('v0.1.0-alpha.1', '0.1.0-alpha.1')).toBe(0);
    expect(compareVersions('0.1.0+build.5', '0.1.0')).toBe(0);
  });

  it('sorts a shorter pre-release first and numbers before words', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1);
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.beta')).toBe(-1);
  });

  it('throws on text that is not a version', () => {
    expect(isVersion('nightly')).toBe(false);
    expect(() => compareVersions('nightly', '0.1.0')).toThrow('not a version: nightly');
  });
});

describe('pickUpdate', () => {
  it('returns the newest release newer than the current one, pre-releases included', () => {
    const update = pickUpdate('0.1.0-alpha.0', [release('v0.1.0-alpha.1'), release('v0.1.0-alpha.2', { notes: 'Fixes' }), release('v0.1.0-alpha.0')]);
    expect(update).toEqual({
      version: '0.1.0-alpha.2',
      url: 'https://github.com/acme/app/releases/tag/v0.1.0-alpha.2',
      publishedAt: '2026-09-28T10:00:00Z',
      notes: 'Fixes',
    });
  });

  it('skips drafts and tags that are not versions', () => {
    expect(pickUpdate('0.1.0-alpha.0', [release('v0.1.0-alpha.1', { draft: true }), release('nightly')])).toBeNull();
  });

  it('is null when the app is up to date or ahead', () => {
    expect(pickUpdate('0.1.0-alpha.1', [release('v0.1.0-alpha.1'), release('v0.1.0-alpha.0')])).toBeNull();
    expect(pickUpdate('0.2.0', [release('v0.1.0')])).toBeNull();
    expect(pickUpdate('0.1.0', [])).toBeNull();
  });

  it('is null when the current version is unknown', () => {
    expect(pickUpdate('', [release('v0.1.0-alpha.1')])).toBeNull();
  });
});

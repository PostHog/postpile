import { describe, expect, it } from 'vitest';
import { compareVersions, hoursBehind, isVersion, laterUntil, pickUpdate, updateUrgency, type ReleaseInfo, type UpdateView } from './index.ts';

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
      behindSince: '2026-09-28T10:00:00Z',
      releasesBehind: 2,
      moreBehind: false,
    });
  });

  it('offers a plain minor release to the first alpha build', () => {
    expect(compareVersions('0.1.0-alpha.0', '0.2.0')).toBe(-1);
    expect(pickUpdate('0.1.0-alpha.0', [release('v0.2.0'), release('v0.1.0-alpha.0')])?.version).toBe('0.2.0');
    expect(pickUpdate('0.2.0', [release('v0.2.1'), release('v0.2.0')])?.version).toBe('0.2.1');
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

describe('how far behind', () => {
  const at = (day: number) => `2026-09-${day}T10:00:00Z`;

  it('counts from the oldest missed release, not the newest', () => {
    const update = pickUpdate('0.2.0', [
      release('v0.2.3', { publishedAt: at(30) }),
      release('v0.2.2', { publishedAt: at(29) }),
      release('v0.2.1', { publishedAt: at(28) }),
      release('v0.2.1-draft', { draft: true, publishedAt: at(27) }),
      release('v0.2.0', { publishedAt: at(26) }),
    ]);
    expect(update).toMatchObject({ version: '0.2.3', behindSince: at(28), releasesBehind: 3, moreBehind: false });
  });

  it('a newer release leaves the clock where it was', () => {
    const before = pickUpdate('0.2.0', [release('v0.2.1', { publishedAt: at(28) }), release('v0.2.0')]);
    const after = pickUpdate('0.2.0', [release('v0.2.2', { publishedAt: at(30) }), release('v0.2.1', { publishedAt: at(28) }), release('v0.2.0')]);
    expect(after?.behindSince).toBe(before?.behindSince);
  });

  it('says there may be more when the oldest fetched release is still newer', () => {
    const fetched = Array.from({ length: 10 }, (_, index) => release(`v0.3.${10 - index}`));
    expect(pickUpdate('0.2.0', fetched)).toMatchObject({ releasesBehind: 10, moreBehind: true });
  });
});

describe('updateUrgency', () => {
  const hour = 60 * 60 * 1000;
  const since = Date.parse('2026-09-28T10:00:00Z');
  const view: UpdateView = {
    current: '0.2.0',
    latest: { ...pickUpdate('0.2.0', [release('v0.2.1', { publishedAt: '2026-09-28T10:00:00Z' })])! },
    checkedAt: null,
    error: null,
  };

  it('is a pill under 24h and a bar from 24h on', () => {
    expect(updateUrgency({ ...view, latest: null }, since, null)).toBe('none');
    expect(updateUrgency(view, since + 23 * hour, null)).toBe('pill');
    expect(updateUrgency(view, since + 24 * hour, null)).toBe('bar');
    expect(hoursBehind(view, since + 30 * hour)).toBe(30);
  });

  it('stays a pill without a known publish time', () => {
    const unknown = { ...view, latest: { ...view.latest!, behindSince: null } };
    expect(updateUrgency(unknown, since + 100 * hour, null)).toBe('pill');
  });

  it('Later hides the pill until the bar is due, then the bar returns', () => {
    const now = since + 5 * hour;
    const until = laterUntil(view, now);
    expect(until).toBe(since + 24 * hour);
    expect(updateUrgency(view, now, until)).toBe('none');
    expect(updateUrgency(view, until, until)).toBe('bar');
  });

  it('Later on the bar drops to the pill for 24h, then the bar returns', () => {
    const now = since + 40 * hour;
    const until = laterUntil(view, now);
    expect(until).toBe(now + 24 * hour);
    expect(updateUrgency(view, now + hour, until)).toBe('pill');
    expect(updateUrgency(view, until, until)).toBe('bar');
  });
});

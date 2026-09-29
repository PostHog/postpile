import { describe, expect, it } from 'vitest';
import { makePr } from '@postpile/core/fixtures';
import { filesTabUrl, keyFileRows, middleTruncate } from './key-files.ts';

describe('middleTruncate', () => {
  it('leaves short paths alone', () => {
    expect(middleTruncate('turbo.json', 20)).toBe('turbo.json');
  });

  it('keeps the file name and cuts the directory', () => {
    const cut = middleTruncate('.github/workflows/nested/turbo-warm-up.yml', 30);
    expect(cut).toBe('.github/wor…/turbo-warm-up.yml');
    expect(cut).toHaveLength(30);
  });

  it('keeps the end of a name longer than the room', () => {
    expect(middleTruncate('src/a-really-long-file-name.ts', 12)).toBe('…ile-name.ts');
  });
});

describe('keyFileRows', () => {
  it('adds the +/- counts from the PR and null when the file is not listed', () => {
    const pr = makePr({ files: [{ path: 'turbo.json', additions: 12, deletions: 4 }] });
    expect(
      keyFileRows(
        [
          { path: 'turbo.json', why: 'cache keys' },
          { path: 'gone.ts', why: 'old snapshot' },
        ],
        pr,
      ),
    ).toEqual([
      { path: 'turbo.json', shortPath: 'turbo.json', why: 'cache keys', additions: 12, deletions: 4 },
      { path: 'gone.ts', shortPath: 'gone.ts', why: 'old snapshot', additions: null, deletions: null },
    ]);
  });
});

describe('filesTabUrl', () => {
  it('points at the files tab', () => {
    expect(filesTabUrl('https://github.com/acme/app/pull/1')).toBe('https://github.com/acme/app/pull/1/files');
    expect(filesTabUrl('https://github.com/acme/app/pull/1/')).toBe('https://github.com/acme/app/pull/1/files');
  });
});

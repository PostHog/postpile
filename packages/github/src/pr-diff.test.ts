import { describe, expect, it } from 'vitest';
import { GitHubClient } from './client.ts';
import { FakeFetch, fakeTokens } from './fake-fetch.ts';
import { DIFF_MAX_PAGES } from './pr-diff.ts';

const ref = { repo: 'acme/app', number: 7 };

describe('GitHubClient.readPrDiff', () => {
  it('keeps ranges only, keyed by the base path, and leaves added files out', async () => {
    const fetch = new FakeFetch([
      {
        body: [
          { filename: 'ci.yml', status: 'modified', changes: 3, patch: '@@ -10,3 +10,3 @@\n a\n-b\n+c\n d' },
          { filename: 'new/name.ts', previous_filename: 'old/name.ts', status: 'renamed', changes: 2, patch: '@@ -1 +1 @@\n-x\n+y' },
          { filename: 'added.ts', status: 'added', changes: 5, patch: '@@ -0,0 +1,5 @@\n+1\n+2\n+3\n+4\n+5' },
          { filename: 'logo.png', status: 'modified', changes: 0 },
        ],
      },
    ]);
    const client = new GitHubClient(fakeTokens, fetch.fn);

    const read = await client.readPrDiff(ref);

    expect(read).toEqual({
      files: [
        { path: 'ci.yml', ranges: [{ start: 11, end: 11 }] },
        { path: 'old/name.ts', ranges: [{ start: 1, end: 1 }] },
      ],
      capped: false,
    });
    expect(fetch.requests[0]?.url).toContain('repos/acme/app/pulls/7/files?per_page=100&page=1');
  });

  it('marks the read capped when GitHub left a changed file’s patch out', async () => {
    const fetch = new FakeFetch([{ body: [{ filename: 'pnpm-lock.yaml', status: 'modified', changes: 4000 }] }]);
    const client = new GitHubClient(fakeTokens, fetch.fn);

    expect(await client.readPrDiff(ref)).toEqual({ files: [], capped: true });
  });

  it('pages until a short page, and marks a PR with more pages than it reads as capped', async () => {
    const page = Array.from({ length: 100 }, (_, index) => ({ filename: `f${index}.ts`, status: 'modified', changes: 1, patch: '@@ -1 +1 @@\n-a\n+b' }));
    const fetch = new FakeFetch(Array.from({ length: DIFF_MAX_PAGES }, () => ({ body: page })));
    const client = new GitHubClient(fakeTokens, fetch.fn);

    const read = await client.readPrDiff(ref);

    expect(fetch.requests).toHaveLength(DIFF_MAX_PAGES);
    expect(read.capped).toBe(true);
    expect(read.files).toHaveLength(DIFF_MAX_PAGES * 100);
  });
});

import { describe, expect, it } from 'vitest';
import { GitHubClient } from './client.ts';
import { FakeFetch, fakeTokens } from './fake-fetch.ts';
import { activityPrs, buildActivityQuery } from './setup-reads.ts';

function node(number: number, repo = 'acme/app', files: string[] = []) {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/${repo}/pull/${number}`,
    state: 'MERGED',
    updatedAt: '2026-09-20T10:00:00Z',
    repository: { nameWithOwner: repo },
    files: { nodes: files.map((path) => ({ path })) },
  };
}

describe('buildActivityQuery', () => {
  it('asks for written, requested and reviewed PRs in one query', () => {
    const query = buildActivityQuery('2026-08-29');
    expect(query).toContain('authored: search(type: ISSUE, first: 40, query: "is:pr author:@me updated:>=2026-08-29 sort:updated-desc")');
    expect(query).toContain('requested: search(type: ISSUE, first: 20, query: "is:pr is:open review-requested:@me sort:updated-desc")');
    expect(query).toContain('"is:pr reviewed-by:@me -author:@me updated:>=2026-08-29 sort:updated-desc"');
    expect(query).toContain('files(first: 50) { nodes { path } }');
  });
});

describe('activityPrs', () => {
  it('keeps each PR once, the first role wins, and sums up its folders', () => {
    const prs = activityPrs({
      authored: { nodes: [node(1, 'acme/app', ['frontend/a.ts', 'frontend/b.ts', 'README.md'])] },
      requested: { nodes: [node(2, 'acme/docs'), {}] },
      reviewed: { nodes: [node(2, 'acme/docs'), node(3), null] },
    });
    expect(prs.map((pr) => [pr.key, pr.role])).toEqual([
      ['acme/app#1', 'authored'],
      ['acme/docs#2', 'review_requested'],
      ['acme/app#3', 'reviewed'],
    ]);
    expect(prs[0]).toMatchObject({ dirs: ['frontend/', '(root)'], state: 'MERGED', updatedAt: '2026-09-20T10:00:00.000Z' });
  });

  it('skips aliases the token could not answer', () => {
    expect(activityPrs({ authored: null, requested: { nodes: [node(5)] } }).map((pr) => pr.number)).toEqual([5]);
  });
});

describe('GitHubClient setup reads', () => {
  it('reads a file raw and answers null for a missing one', async () => {
    const fetch = new FakeFetch([{ body: '/.github/ @acme/devex\n' }, { status: 404, body: { message: 'Not Found' } }]);
    const client = new GitHubClient(fakeTokens, fetch.fn);
    // FakeFetch sends every body as JSON, so the raw text arrives quoted here.
    await expect(client.readRepoFile('acme/app', '.github/CODEOWNERS')).resolves.toContain('/.github/ @acme/devex');
    await expect(client.readRepoFile('acme/app', 'CODEOWNERS')).resolves.toBeNull();
    expect(fetch.requests[0]?.url).toBe('https://api.github.com/repos/acme/app/contents/.github/CODEOWNERS');
    expect(fetch.requests[0]?.headers.accept).toBe('application/vnd.github.raw+json');
  });

  it('says why notifications cannot be read', async () => {
    const fetch = new FakeFetch([{ body: [] }, { status: 403, body: { message: 'Missing the notifications scope' } }]);
    const client = new GitHubClient(fakeTokens, fetch.fn);
    await expect(client.probeNotifications()).resolves.toBeNull();
    await expect(client.probeNotifications()).resolves.toContain('Missing the notifications scope');
    expect(fetch.requests[0]?.url).toBe('https://api.github.com/notifications?per_page=1');
  });
});

import { describe, expect, it } from 'vitest';
import { FakeFetch, fakeTokens } from './fake-fetch.ts';
import { GitHubClient } from './client.ts';
import { buildScoutListQuery, buildTreeQuery } from './scouts.ts';

function listed(number: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `PR_${number}`,
    number,
    updatedAt: '2026-10-29T10:00:00Z',
    state: 'OPEN',
    isDraft: false,
    mergedAt: null,
    headRefOid: `h${number}`,
    baseRefOid: `b${number}`,
    title: `PR ${number}`,
    body: null,
    author: { __typename: 'Bot', login: 'codegen-agent' },
    assignees: { nodes: [{ login: 'dmitri' }, null] },
    repository: { nameWithOwner: 'acme/app' },
    ...overrides,
  };
}

function filesPage(head: string, nodes: { path: string; changeType: string }[], next: string | null) {
  return { headRefOid: head, baseRefOid: 'b1', files: { pageInfo: { hasNextPage: next !== null, endCursor: next }, nodes } };
}

describe('scout listing', () => {
  it('asks for open and merged PRs by update time, with a cursor after the first page', () => {
    expect(buildScoutListQuery('acme/app', null)).toContain('states: [OPEN, MERGED], orderBy: { field: UPDATED_AT, direction: DESC }');
    expect(buildScoutListQuery('acme/app', 'abc')).toContain('after: "abc"');
  });

  it('reads one page into candidates and the next cursor', async () => {
    const fetch = new FakeFetch([
      { body: { data: { repository: { pullRequests: { pageInfo: { hasNextPage: true, endCursor: 'c1' }, nodes: [listed(1)] } } } } },
    ]);
    const client = new GitHubClient(fakeTokens, fetch.fn);

    const page = await client.listScoutPrs('acme/app', null);

    expect(page.nextCursor).toBe('c1');
    expect(page.prs).toEqual([
      {
        key: 'acme/app#1',
        nodeId: 'PR_1',
        title: 'PR 1',
        body: '',
        author: 'codegen-agent[bot]',
        assignees: ['dmitri'],
        isDraft: false,
        state: 'OPEN',
        headOid: 'h1',
        baseOid: 'b1',
        updatedAt: '2026-10-29T10:00:00.000Z',
        mergedAt: null,
      },
    ]);
  });

  it('refuses a page with a null node or field errors: it would miss a PR', async () => {
    const withNull = new FakeFetch([{ body: { data: { repository: { pullRequests: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [listed(1), null] } } } } }]);
    await expect(new GitHubClient(fakeTokens, withNull.fn).listScoutPrs('acme/app', null)).rejects.toThrow('incomplete page');
    const withErrors = new FakeFetch([
      { body: { data: { repository: { pullRequests: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [listed(1)] } } }, errors: [{ message: 'Something went wrong' }] } },
    ]);
    await expect(new GitHubClient(fakeTokens, withErrors.fn).listScoutPrs('acme/app', null)).rejects.toThrow('incomplete page');
  });

  it('fails a repo the token cannot see', async () => {
    const fetch = new FakeFetch([{ body: { data: { repository: null }, errors: [{ message: 'Could not resolve to a Repository' }] } }]);
    await expect(new GitHubClient(fakeTokens, fetch.fn).listScoutPrs('acme/secret', null)).rejects.toThrow('Could not resolve');
  });

  it('looks PRs up by number, keyed as asked', async () => {
    const fetch = new FakeFetch([{ body: { data: { p0: { pullRequest: listed(5, { repository: { nameWithOwner: 'Acme/App' } }) }, p1: { pullRequest: null } } } }]);
    const found = await new GitHubClient(fakeTokens, fetch.fn).scoutPrsByNumber([
      { repo: 'acme/app', number: 5 },
      { repo: 'acme/app', number: 6 },
    ]);
    expect([...found.keys()]).toEqual(['acme/app#5']);
  });
});

describe('scout files', () => {
  it('pages a long file list to the end', async () => {
    const fetch = new FakeFetch([
      { body: { data: { p0: { pullRequest: filesPage('h1', [{ path: 'a.ts', changeType: 'MODIFIED' }], 'f1') } } } },
      { body: { data: { p0: { pullRequest: filesPage('h1', [{ path: 'new/b.ts', changeType: 'ADDED' }], null) } } } },
    ]);
    const read = await new GitHubClient(fakeTokens, fetch.fn).scoutFiles([{ repo: 'acme/app', number: 1 }]);

    expect(read.get('acme/app#1')).toEqual({
      headOid: 'h1',
      baseOid: 'b1',
      files: [
        { path: 'a.ts', changeType: 'MODIFIED' },
        { path: 'new/b.ts', changeType: 'ADDED' },
      ],
    });
    expect(JSON.stringify(fetch.requests[1]!.body)).toContain('after: \\"f1\\"');
  });

  it('asks for the next pages of several long lists in one query', async () => {
    const fetch = new FakeFetch([
      {
        body: {
          data: {
            p0: { pullRequest: filesPage('h1', [{ path: 'a.ts', changeType: 'MODIFIED' }], 'f1') },
            p1: { pullRequest: { ...filesPage('h2', [{ path: 'b.ts', changeType: 'MODIFIED' }], 'g1'), baseRefOid: 'b1' } },
          },
        },
      },
      {
        body: {
          data: {
            p0: { pullRequest: filesPage('h1', [{ path: 'a2.ts', changeType: 'ADDED' }], null) },
            p1: { pullRequest: filesPage('h2', [{ path: 'b2.ts', changeType: 'ADDED' }], null) },
          },
        },
      },
    ]);
    const read = await new GitHubClient(fakeTokens, fetch.fn).scoutFiles([
      { repo: 'acme/app', number: 1 },
      { repo: 'acme/app', number: 2 },
    ]);
    expect(fetch.requests).toHaveLength(2);
    expect(read.get('acme/app#1')?.files?.map((file) => file.path)).toEqual(['a.ts', 'a2.ts']);
    expect(read.get('acme/app#2')?.files?.map((file) => file.path)).toEqual(['b.ts', 'b2.ts']);
  });

  it('gives no list when the head moved while paging', async () => {
    const fetch = new FakeFetch([
      { body: { data: { p0: { pullRequest: filesPage('h1', [{ path: 'a.ts', changeType: 'MODIFIED' }], 'f1') } } } },
      { body: { data: { p0: { pullRequest: filesPage('h2', [{ path: 'b.ts', changeType: 'ADDED' }], null) } } } },
    ]);
    const read = await new GitHubClient(fakeTokens, fetch.fn).scoutFiles([{ repo: 'acme/app', number: 1 }]);
    expect(read.get('acme/app#1')?.files).toBeNull();
  });

  it('gives no list when a later page fails', async () => {
    const fetch = new FakeFetch([
      { body: { data: { p0: { pullRequest: filesPage('h1', [{ path: 'a.ts', changeType: 'MODIFIED' }], 'f1') } } } },
      { status: 502, body: { message: 'bad gateway' } },
    ]);
    const read = await new GitHubClient(fakeTokens, fetch.fn).scoutFiles([{ repo: 'acme/app', number: 1 }]);
    expect(read.get('acme/app#1')?.files).toBeNull();
  });
});

describe('top-level folders', () => {
  it('keeps directories only, per commit', async () => {
    expect(buildTreeQuery('acme/app', ['c1'])).toContain('t0: object(oid: "c1") { ... on Commit { tree { entries { name type } } } }');
    const fetch = new FakeFetch([
      {
        body: {
          data: {
            repository: {
              t0: { tree: { entries: [{ name: 'src', type: 'tree' }, { name: 'README.md', type: 'blob' }] } },
              t1: null,
            },
          },
        },
      },
    ]);
    const folders = await new GitHubClient(fakeTokens, fetch.fn).topLevelFolders('acme/app', ['c1', 'c2']);
    expect(folders).toEqual(new Map([['c1', ['src']]]));
  });
});

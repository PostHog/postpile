import { describe, expect, it } from 'vitest';
import { GitHubClient } from './client.ts';
import { buildCodeOwnersQuery } from './code-owners.ts';
import { FakeFetch, fakeTokens } from './fake-fetch.ts';

describe('buildCodeOwnersQuery', () => {
  it("asks each repo's default branch for all three places, in GitHub's order", () => {
    const query = buildCodeOwnersQuery(['acme/app', 'acme/api']);
    expect(query).toContain(
      'r0: repository(owner: "acme", name: "app") { f0: object(expression: "HEAD:.github/CODEOWNERS") { ... on Blob { oid text isTruncated } } f1: object(expression: "HEAD:CODEOWNERS")',
    );
    expect(query).toContain('f2: object(expression: "HEAD:docs/CODEOWNERS")');
    expect(query).toContain('r1: repository(owner: "acme", name: "api")');
  });
});

describe('codeOwnersFiles', () => {
  it('takes the first file found, null for a repo without one, and leaves out a repo it cannot see', async () => {
    const fake = new FakeFetch([
      {
        body: {
          data: {
            r0: { f0: null, f1: { oid: 'abc', text: '* @acme/core\n', isTruncated: false }, f2: { oid: 'def', text: 'x', isTruncated: false } },
            r1: { f0: null, f1: null, f2: null },
            r2: null,
            r3: { f0: { oid: 'big', text: '...', isTruncated: true }, f1: null, f2: null },
          },
          errors: [{ message: 'Could not resolve to a Repository', path: ['r2'] }],
        },
      },
    ]);
    const client = new GitHubClient(fakeTokens, fake.fn);

    const files = await client.codeOwnersFiles(['acme/app', 'acme/empty', 'acme/secret', 'acme/huge']);

    expect([...files]).toEqual([
      ['acme/app', { path: 'CODEOWNERS', oid: 'abc', text: '* @acme/core\n' }],
      ['acme/empty', null],
      ['acme/huge', { path: '.github/CODEOWNERS', oid: 'big', text: null }],
    ]);
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]?.method).toBe('POST');
  });

  it('throws when GitHub answers no data at all', async () => {
    const fake = new FakeFetch([{ body: { data: null, errors: [{ message: 'Bad credentials' }] } }]);
    await expect(new GitHubClient(fakeTokens, fake.fn).codeOwnersFiles(['acme/app'])).rejects.toThrow('CODEOWNERS query');
  });
});

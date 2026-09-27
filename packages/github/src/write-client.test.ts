// Only ever runs against FakeFetch. Nothing here may reach the real API.
import { describe, expect, it } from 'vitest';
import { FakeFetch, fakeTokens } from './fake-fetch.ts';
import { GitHubError } from './http.ts';
import { GitHubWriteClient } from './write-client.ts';

const ref = { repo: 'acme/app', number: 42 };

describe('GitHubWriteClient', () => {
  it('marks a thread read with PATCH', async () => {
    const fake = new FakeFetch([{ status: 205 }]);
    await new GitHubWriteClient(fakeTokens, fake.fn).markThreadRead('1001');
    expect(fake.requests).toEqual([
      expect.objectContaining({ method: 'PATCH', url: 'https://api.github.com/notifications/threads/1001', body: undefined }),
    ]);
  });

  it('approves with an APPROVE review and leaves out an empty body', async () => {
    const fake = new FakeFetch([{ body: { id: 1 } }, { body: { id: 2 } }]);
    const writer = new GitHubWriteClient(fakeTokens, fake.fn);

    await writer.approvePr(ref, '');
    await writer.approvePr(ref, 'Ship it');

    expect(fake.requests.map((r) => [r.method, r.url, r.body])).toEqual([
      ['POST', 'https://api.github.com/repos/acme/app/pulls/42/reviews', { event: 'APPROVE' }],
      ['POST', 'https://api.github.com/repos/acme/app/pulls/42/reviews', { event: 'APPROVE', body: 'Ship it' }],
    ]);
    expect(fake.requests[0]?.headers['content-type']).toBe('application/json');
  });

  it('comments through the issue comments endpoint', async () => {
    const fake = new FakeFetch([{ status: 201, body: { id: 3 } }]);
    await new GitHubWriteClient(fakeTokens, fake.fn).commentOnPr(ref, '@bob can you check this?');
    expect(fake.requests[0]).toMatchObject({
      method: 'POST',
      url: 'https://api.github.com/repos/acme/app/issues/42/comments',
      body: { body: '@bob can you check this?' },
    });
  });

  it('throws GitHubError on a failed write', async () => {
    const fake = new FakeFetch([{ status: 422, body: { message: 'Can not approve your own pull request' } }]);
    const call = new GitHubWriteClient(fakeTokens, fake.fn).approvePr(ref, '');
    await expect(call).rejects.toBeInstanceOf(GitHubError);
    await expect(call).rejects.toThrow(/422: Can not approve your own pull request/);
  });
});

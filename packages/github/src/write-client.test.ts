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

  it('marks everything (or one repo) before a time read with one PUT, and takes a 202', async () => {
    const fake = new FakeFetch([{ status: 202, body: { message: 'queued' } }, { status: 205 }]);
    const writer = new GitHubWriteClient(fakeTokens, fake.fn);
    await writer.markAllReadBefore('2026-09-14T12:00:00.000Z');
    await writer.markRepoReadBefore('acme/app', '2026-09-28T12:00:00.000Z');
    expect(fake.requests.map((r) => [r.method, r.url, r.body])).toEqual([
      ['PUT', 'https://api.github.com/notifications', { last_read_at: '2026-09-14T12:00:00.000Z', read: true }],
      ['PUT', 'https://api.github.com/repos/acme/app/notifications', { last_read_at: '2026-09-28T12:00:00.000Z' }],
    ]);
  });

  it('approves with an APPROVE review and leaves out an empty body', async () => {
    const fake = new FakeFetch([{ body: { id: 1 } }, { body: { id: 2 } }]);
    const writer = new GitHubWriteClient(fakeTokens, fake.fn);

    await writer.approvePr(ref, '', 'abc123');
    await writer.approvePr(ref, 'Ship it', 'abc123');

    expect(fake.requests.map((r) => [r.method, r.url, r.body])).toEqual([
      ['POST', 'https://api.github.com/repos/acme/app/pulls/42/reviews', { event: 'APPROVE', commit_id: 'abc123' }],
      [
        'POST',
        'https://api.github.com/repos/acme/app/pulls/42/reviews',
        { event: 'APPROVE', commit_id: 'abc123', body: 'Ship it' },
      ],
    ]);
    expect(fake.requests[0]?.headers['content-type']).toBe('application/json');
  });

  it('posts a comment review as a COMMENT review pinned to the commit', async () => {
    const fake = new FakeFetch([{ body: { id: 4 } }]);
    await new GitHubWriteClient(fakeTokens, fake.fn).commentReviewPr(ref, 'Read the cache change, no concerns.', 'abc123');
    expect(fake.requests.map((r) => [r.method, r.url, r.body])).toEqual([
      ['POST', 'https://api.github.com/repos/acme/app/pulls/42/reviews', { event: 'COMMENT', commit_id: 'abc123', body: 'Read the cache change, no concerns.' }],
    ]);
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

  it('replies in a review thread through addPullRequestReviewThreadReply', async () => {
    const fake = new FakeFetch([{ body: { data: { addPullRequestReviewThreadReply: { comment: { id: 'RC9' } } } } }]);
    await new GitHubWriteClient(fakeTokens, fake.fn).replyInThread('T1', 'Fixed in the last push.');
    expect(fake.requests).toHaveLength(1);
    const request = fake.requests[0]!;
    expect([request.method, request.url]).toEqual(['POST', 'https://api.github.com/graphql']);
    const body = request.body as { query: string; variables: unknown };
    expect(body.query).toContain('addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body })');
    expect(body.variables).toEqual({ threadId: 'T1', body: 'Fixed in the last push.' });
  });

  it('adds a THUMBS_UP reaction through addReaction', async () => {
    const fake = new FakeFetch([{ body: { data: { addReaction: { reaction: { content: 'THUMBS_UP' } } } } }]);
    await new GitHubWriteClient(fakeTokens, fake.fn).addThumbsUp('IC1');
    const body = fake.requests[0]!.body as { query: string; variables: unknown };
    expect(fake.requests[0]!.url).toBe('https://api.github.com/graphql');
    expect(body.query).toContain('addReaction(input: { subjectId: $subjectId, content: THUMBS_UP })');
    expect(body.variables).toEqual({ subjectId: 'IC1' });
  });

  it('throws GitHubError when GitHub refuses a mutation with a 200 and errors', async () => {
    const fake = new FakeFetch([{ body: { data: null, errors: [{ message: 'Could not resolve to a node with the global id of T404' }] } }]);
    const call = new GitHubWriteClient(fakeTokens, fake.fn).replyInThread('T404', 'Hi');
    await expect(call).rejects.toBeInstanceOf(GitHubError);
    await expect(call).rejects.toThrow(/thread reply failed: Could not resolve/);
  });

  it('removes one team review request with DELETE and an empty user list', async () => {
    const fake = new FakeFetch([{ status: 200, body: { number: 42 } }]);
    await new GitHubWriteClient(fakeTokens, fake.fn).removeTeamReviewRequest(ref, 'team-platform');
    expect(fake.requests.map((r) => [r.method, r.url, r.body])).toEqual([
      ['DELETE', 'https://api.github.com/repos/acme/app/pulls/42/requested_reviewers', { reviewers: [], team_reviewers: ['team-platform'] }],
    ]);
  });

  it('unsubscribes from a thread by deleting its subscription', async () => {
    const fake = new FakeFetch([{ status: 204 }]);
    await new GitHubWriteClient(fakeTokens, fake.fn).unsubscribeThread('1001');
    expect(fake.requests.map((r) => [r.method, r.url, r.body])).toEqual([['DELETE', 'https://api.github.com/notifications/threads/1001/subscription', undefined]]);
  });

  it('throws GitHubError on a failed write', async () => {
    const fake = new FakeFetch([{ status: 422, body: { message: 'Can not approve your own pull request' } }]);
    const call = new GitHubWriteClient(fakeTokens, fake.fn).approvePr(ref, '', 'abc123');
    await expect(call).rejects.toBeInstanceOf(GitHubError);
    await expect(call).rejects.toThrow(/422: Can not approve your own pull request/);
  });
});

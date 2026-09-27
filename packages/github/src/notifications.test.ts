import { describe, expect, it } from 'vitest';
import { GitHubClient } from './client.ts';
import { FakeFetch, fakeTokens, loadFixture } from './fake-fetch.ts';
import { GitHubError } from './http.ts';
import { nextPageUrl } from './notifications.ts';

const PAGE_2 = 'https://api.github.com/notifications?all=false&per_page=50&page=2';

describe('nextPageUrl', () => {
  it('picks the next link out of a Link header', () => {
    const header = `<${PAGE_2}>; rel="next", <https://api.github.com/notifications?page=4>; rel="last"`;
    expect(nextPageUrl(header)).toBe(PAGE_2);
  });

  it('returns null on the last page', () => {
    expect(nextPageUrl('<https://api.github.com/notifications?page=1>; rel="prev"')).toBeNull();
    expect(nextPageUrl(null)).toBeNull();
  });
});

describe('listNotifications', () => {
  it('walks every page and normalizes threads', async () => {
    const fake = new FakeFetch([
      {
        body: loadFixture('notifications-page1.json'),
        headers: { etag: 'W/"abc"', 'last-modified': 'Sat, 20 Sep 2026 10:00:00 GMT', link: `<${PAGE_2}>; rel="next"` },
      },
      { body: loadFixture('notifications-page2.json'), headers: { etag: 'W/"page2"' } },
    ]);
    const client = new GitHubClient(fakeTokens, fake.fn);

    const result = await client.listNotifications({ etag: null, lastModified: null });

    expect(result).toMatchObject({ notModified: false, etag: 'W/"abc"', lastModified: 'Sat, 20 Sep 2026 10:00:00 GMT' });
    if (result.notModified) throw new Error('expected threads');
    expect(result.threads.map((t) => [t.id, t.reason, t.repo, t.number, t.subjectType])).toEqual([
      ['1001', 'review_requested', 'acme/app', 42, 'PullRequest'],
      // Unknown reason becomes "other"; a release id is not a PR number.
      ['1002', 'other', 'acme/app', null, 'Release'],
      ['1003', 'team_mention', 'acme/api', 7, 'Issue'],
      ['1004', 'mention', 'acme/api', null, 'Discussion'],
    ]);
    expect(result.threads[1]?.lastReadAt).toBe('2026-09-19T09:00:00Z');

    expect(fake.requests.map((r) => r.url)).toEqual([
      'https://api.github.com/notifications?all=false&per_page=50',
      PAGE_2,
    ]);
    expect(fake.requests[0]?.headers.authorization).toBe('Bearer test-token');
  });

  it('sends the previous ETag and Last-Modified and reports 304 as notModified', async () => {
    const fake = new FakeFetch([{ status: 304 }]);
    const client = new GitHubClient(fakeTokens, fake.fn);

    const result = await client.listNotifications({ etag: 'W/"abc"', lastModified: 'Sat, 20 Sep 2026 10:00:00 GMT' });

    expect(result).toEqual({ notModified: true });
    expect(fake.requests[0]?.headers['if-none-match']).toBe('W/"abc"');
    expect(fake.requests[0]?.headers['if-modified-since']).toBe('Sat, 20 Sep 2026 10:00:00 GMT');
  });

  it('only makes the first page conditional', async () => {
    const fake = new FakeFetch([
      { body: [], headers: { link: `<${PAGE_2}>; rel="next"` } },
      { body: [] },
    ]);
    const client = new GitHubClient(fakeTokens, fake.fn);

    await client.listNotifications({ etag: 'W/"old"', lastModified: null });

    expect(fake.requests[0]?.headers['if-none-match']).toBe('W/"old"');
    expect(fake.requests[1]?.headers['if-none-match']).toBeUndefined();
  });

  it('throws GitHubError with the message on failure', async () => {
    const fake = new FakeFetch([{ status: 401, body: { message: 'Bad credentials' } }]);
    const client = new GitHubClient(fakeTokens, fake.fn);

    const call = client.listNotifications({ etag: null, lastModified: null });

    await expect(call).rejects.toBeInstanceOf(GitHubError);
    await expect(call).rejects.toThrow(/401: Bad credentials/);
  });
});

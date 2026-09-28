import { describe, expect, it } from 'vitest';
import { GitHubClient } from './client.ts';
import { FakeFetch, fakeTokens } from './fake-fetch.ts';

const PAGE_2 = 'https://api.github.com/orgs/PostHog/teams/team-devex/members?per_page=100&page=2';

describe('teamMembers', () => {
  it('walks every page and keeps the first page ETag', async () => {
    const fake = new FakeFetch([
      { body: [{ login: 'lyra' }, { login: 'viewer' }], headers: { etag: 'W/"t1"', link: `<${PAGE_2}>; rel="next"` } },
      { body: [{ login: 'rowan' }] },
    ]);
    const result = await new GitHubClient(fakeTokens, fake.fn).teamMembers('PostHog/team-devex', null);
    expect(result).toEqual({ notModified: false, logins: ['lyra', 'viewer', 'rowan'], etag: 'W/"t1"' });
    expect(fake.requests[0]?.url).toBe('https://api.github.com/orgs/PostHog/teams/team-devex/members?per_page=100');
    expect(fake.requests[0]?.headers['if-none-match']).toBeUndefined();
  });

  it('sends the ETag and reports an unchanged team', async () => {
    const fake = new FakeFetch([{ status: 304 }]);
    const result = await new GitHubClient(fakeTokens, fake.fn).teamMembers('PostHog/team-devex', 'W/"t1"');
    expect(result).toEqual({ notModified: true });
    expect(fake.requests[0]?.headers['if-none-match']).toBe('W/"t1"');
  });

  it('answers an empty list for a team the token cannot read', async () => {
    const fake = new FakeFetch([{ status: 403, body: { message: 'Resource protected by organization SAML enforcement' } }]);
    expect(await new GitHubClient(fakeTokens, fake.fn).teamMembers('Other/team', null)).toEqual({ notModified: false, logins: [], etag: null });
  });
});

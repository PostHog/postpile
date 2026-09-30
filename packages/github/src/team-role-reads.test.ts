import { describe, expect, it } from 'vitest';
import { GitHubClient } from './client.ts';
import { FakeFetch, fakeTokens } from './fake-fetch.ts';
import { reviewedPrs, reviewedSearch, teamSizes, type RawReviewedNode } from './team-role-reads.ts';

function reviewed(number: number, requested: (object | null)[]): RawReviewedNode {
  return {
    number,
    repository: { nameWithOwner: 'acme/app' },
    timelineItems: { nodes: requested.map((requestedReviewer) => ({ requestedReviewer })) },
  };
}

const team = (slug: string) => ({ __typename: 'Team', slug, organization: { login: 'acme' } });
const user = (login: string) => ({ __typename: 'User', login });

function page(nodes: (RawReviewedNode | null)[], endCursor: string | null) {
  return { data: { search: { pageInfo: { hasNextPage: endCursor !== null, endCursor }, nodes } } };
}

describe('team role reads', () => {
  it('searches reviews by the viewer on other people\'s PRs in their orgs', () => {
    expect(reviewedSearch('alice', ['acme', 'beta'], '2026-07-02')).toBe('is:pr reviewed-by:alice -author:alice updated:>=2026-07-02 org:acme org:beta');
    expect(reviewedSearch('alice', [], '2026-07-02')).toBe('is:pr reviewed-by:alice -author:alice updated:>=2026-07-02');
  });

  it('lists who was requested on each PR, users and teams, bots and empty hits left out', () => {
    const prs = reviewedPrs(
      page([reviewed(1, [team('team-devex'), user('alice'), team('team-devex')]), reviewed(2, [{ __typename: 'Bot' }, null]), {}, null], null).data,
    );
    expect(prs).toEqual([
      { key: 'acme/app#1', requested: ['acme/team-devex', 'alice'] },
      { key: 'acme/app#2', requested: [] },
    ]);
  });

  it('reads member counts and skips orgs the token cannot see', () => {
    const sizes = teamSizes({
      viewer: {
        organizations: {
          nodes: [
            { login: 'acme', teams: { nodes: [{ slug: 'team-devex', members: { totalCount: 3 } }, { slug: 'hidden', members: null }] } },
            null,
          ],
        },
      },
    });
    expect(sizes).toEqual([
      { team: 'acme/team-devex', members: 3 },
      { team: 'acme/hidden', members: null },
    ]);
    expect(teamSizes(null)).toEqual([]);
  });

  it('pages through the reviewed PRs up to the cap', async () => {
    const first = Array.from({ length: 50 }, (_, index) => reviewed(index + 1, [team('team-devex')]));
    const second = Array.from({ length: 50 }, (_, index) => reviewed(index + 51, [user('alice')]));
    const fetch = new FakeFetch([{ body: page(first, 'c1') }, { body: page(second, 'c2') }]);
    const client = new GitHubClient(fakeTokens, fetch.fn);
    const prs = await client.reviewedPrRequests('alice', ['acme'], '2026-07-02', 80);
    expect(prs).toHaveLength(80);
    expect(fetch.requests).toHaveLength(2);
    expect((fetch.requests[1]!.body as { variables: { after: string } }).variables.after).toBe('c1');
  });

  it('stops at the last page', async () => {
    const fetch = new FakeFetch([{ body: page([reviewed(1, [])], null) }]);
    const client = new GitHubClient(fakeTokens, fetch.fn);
    await expect(client.reviewedPrRequests('alice', ['acme'], '2026-07-02', 200)).resolves.toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';
import { GitHubClient } from './client.ts';
import { FakeFetch, fakeTokens } from './fake-fetch.ts';
import { buildFoundQuery, foundRefs } from './found.ts';

describe('buildFoundQuery', () => {
  it('asks for own open PRs, review requests per person and team, and recent merges in one query', () => {
    const { query, aliases } = buildFoundQuery(['acme/team-platform', 'acme/team-infra'], '2026-09-21');
    expect(aliases.map((alias) => [alias.alias, alias.via, alias.team])).toEqual([
      ['own', 'own_open', null],
      ['assigned', 'assigned', null],
      ['review', 'review_requested', null],
      ['team0', 'team_review_requested', 'acme/team-platform'],
      ['team1', 'team_review_requested', 'acme/team-infra'],
      ['merged', 'involved_merged', null],
    ]);
    expect(query).toContain('pullRequests(states: OPEN, first: 100, orderBy: { field: UPDATED_AT, direction: DESC })');
    expect(query).toContain('"is:pr is:open assignee:@me"');
    expect(query).toContain('author { __typename login }');
    expect(query).toContain('"is:pr is:open user-review-requested:@me"');
    expect(query).toContain('"is:pr is:open team-review-requested:acme/team-infra"');
    expect(query).toContain('"is:pr involves:@me is:merged merged:>=2026-09-21"');
  });
});

describe('foundRefs', () => {
  it('keeps each PR once, most aimed alias first, and skips empty hits', () => {
    const query = buildFoundQuery(['o/t'], '2026-09-21');
    const node = (number: number, extra: object = {}) => ({ number, updatedAt: '2026-09-27T10:00:00Z', repository: { nameWithOwner: 'o/r' }, ...extra });
    const refs = foundRefs(query, {
      own: { pullRequests: { nodes: [node(1)] } },
      review: { nodes: [node(2), {}] },
      team0: { nodes: [node(2), node(3)] },
      merged: { nodes: [node(1), node(4, { mergedAt: '2026-09-24T08:00:00Z' })] },
    });
    expect(refs.map((ref) => [ref.ref.number, ref.via, ref.reason])).toEqual([
      [2, 'review_requested', 'review requested from you'],
      [3, 'team_review_requested', 'review requested from o/t'],
      [1, 'own_open', 'your open PR'],
      [4, 'involved_merged', 'involves you, merged 2026-09-24'],
    ]);
  });

  it('finds every open PR assigned to the viewer: a bot\'s as their own, a person\'s as assigned', () => {
    const query = buildFoundQuery([], '2026-09-21');
    const node = (number: number, __typename: string, login: string) => ({
      number,
      updatedAt: '2026-09-27T10:00:00Z',
      repository: { nameWithOwner: 'o/r' },
      author: { __typename, login },
    });
    // #6 is the viewer's own, self-assigned: the own alias found it first.
    const refs = foundRefs(query, {
      own: { pullRequests: { nodes: [node(6, 'User', 'octocat')] } },
      assigned: { nodes: [node(6, 'User', 'octocat'), node(7, 'Bot', 'acme-agent'), node(8, 'User', 'alice')] },
    });
    expect(refs.map((ref) => [ref.ref.number, ref.via, ref.reason])).toEqual([
      [6, 'own_open', 'your open PR'],
      [7, 'own_open', 'agent PR assigned to you'],
      [8, 'assigned', 'assigned to you'],
    ]);
  });

  it('judges the author like prOwners: automation on a user account is a bot, a deleted author is not', () => {
    const query = buildFoundQuery([], '2026-09-21');
    const node = (number: number, author: { __typename: string; login: string } | null) => ({
      number,
      updatedAt: '2026-09-27T10:00:00Z',
      repository: { nameWithOwner: 'o/r' },
      author,
    });
    const refs = foundRefs(query, {
      assigned: { nodes: [node(9, { __typename: 'User', login: 'renovate' }), node(10, null)] },
    });
    expect(refs.map((ref) => [ref.ref.number, ref.via, ref.reason])).toEqual([
      [9, 'own_open', 'agent PR assigned to you'],
      [10, 'assigned', 'assigned to you'],
    ]);
  });
});

describe('GitHubClient.findPrs', () => {
  it('sends one GraphQL request and uses partial data', async () => {
    const fake = new FakeFetch([
      {
        body: {
          data: { own: null, review: { nodes: [{ number: 5, updatedAt: '2026-09-27T10:00:00Z', repository: { nameWithOwner: 'o/r' } }] }, merged: { nodes: [] } },
          errors: [{ message: 'own failed' }],
        },
      },
    ]);
    const refs = await new GitHubClient(fakeTokens, fake.fn).findPrs([], '2026-09-21');
    expect(fake.requests).toHaveLength(1);
    expect(refs.map((ref) => ref.ref.number)).toEqual([5]);
  });
});

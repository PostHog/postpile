import { describe, expect, it } from 'vitest';
import { GitHubClient } from './client.ts';
import { FakeFetch, fakeTokens, loadFixture } from './fake-fetch.ts';
import { buildBranchQuery, buildPrBatchQuery } from './queries.ts';
import { PR_BATCH_SIZE } from './reader.ts';

const refs = [
  { repo: 'acme/app', number: 42 },
  { repo: 'acme/secret', number: 1 },
  { repo: 'acme/api', number: 8 },
];

describe('buildPrBatchQuery', () => {
  it('aliases one repository lookup per PR and appends the fragments', () => {
    const query = buildPrBatchQuery(refs);
    expect(query).toContain('p0: repository(owner: "acme", name: "app") { pullRequest(number: 42) { ...prData } }');
    expect(query).toContain('p2: repository(owner: "acme", name: "api") { pullRequest(number: 8) { ...prData } }');
    expect(query).toContain('fragment prData on PullRequest');
    expect(query).toContain('... on DeployedEvent { id createdAt actor { ...actor } }');
  });
});

describe('fetchPrs', () => {
  it('normalizes a batch and leaves out PRs that did not resolve', async () => {
    const fake = new FakeFetch([{ body: loadFixture('pr-batch.json') }]);
    const client = new GitHubClient(fakeTokens, fake.fn);

    const prs = await client.fetchPrs(refs);

    expect([...prs.keys()]).toEqual(['acme/app#42', 'acme/api#8']);
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]?.method).toBe('POST');
    expect(fake.requests[0]?.url).toBe('https://api.github.com/graphql');
  });

  it('maps PR fields, reviewers, reviews and commits', async () => {
    const fake = new FakeFetch([{ body: loadFixture('pr-batch.json') }]);
    const pr = (await new GitHubClient(fakeTokens, fake.fn).fetchPrs(refs)).get('acme/app#42')!;

    expect(pr).toMatchObject({
      key: 'acme/app#42',
      ref: { repo: 'acme/app', number: 42 },
      author: 'alice',
      state: 'OPEN',
      isDraft: false,
      baseRef: 'alice/depot-base',
      headRef: 'alice/depot-runners',
      headOid: 'c2',
      reviewDecision: 'REVIEW_REQUIRED',
      labels: ['ci'],
      mergedBy: null,
    });
    expect(pr.files.map((f) => f.path)).toEqual(['.github/workflows/ci.yml', 'depot.json']);
    // Bot reviewers are dropped; teams are "org/slug".
    expect(pr.reviewerUsers).toEqual(['viewer']);
    expect(pr.reviewerTeams).toEqual(['acme/infra']);
    expect(pr.reviews).toEqual([
      { id: 'R1', author: 'bob', state: 'APPROVED', body: 'LGTM', submittedAt: '2026-09-19T10:00:00.000Z', commitOid: 'c1' },
      // Bot logins get the REST-style suffix so isBot() catches them.
      { id: 'R2', author: 'greptile-apps[bot]', state: 'COMMENTED', body: '  ', submittedAt: '2026-09-19T11:00:00.000Z', commitOid: 'c1' },
    ]);
    expect(pr.commits).toEqual([
      { oid: 'c1', headline: 'Add depot config', author: 'alice', committedAt: '2026-09-18T09:00:00.000Z' },
      { oid: 'c2', headline: 'Fix cache', author: 'Alice Laptop', committedAt: '2026-09-20T09:00:00.000Z' },
    ]);
  });

  it('flattens comments oldest first and keeps threads', async () => {
    const fake = new FakeFetch([{ body: loadFixture('pr-batch.json') }]);
    const pr = (await new GitHubClient(fakeTokens, fake.fn).fetchPrs(refs)).get('acme/app#42')!;

    expect(pr.comments.map((c) => [c.id, c.kind, c.author])).toEqual([
      ['IC2', 'comment', ''],
      ['RC1', 'review_comment', 'bob'],
      ['R1', 'review', 'bob'],
      ['IC1', 'comment', 'carol'],
    ]);
    expect(pr.comments[1]).toMatchObject({ path: 'depot.json', threadId: 'T1' });
    expect(pr.threads).toHaveLength(1);
    expect(pr.threads[0]).toMatchObject({ id: 'T1', path: 'depot.json', isResolved: false });
    expect(pr.threads[0]?.comments[0]?.body).toBe('Why this project id?');
  });

  it('maps timeline items and checks', async () => {
    const fake = new FakeFetch([{ body: loadFixture('pr-batch.json') }]);
    const prs = await new GitHubClient(fakeTokens, fake.fn).fetchPrs(refs);
    const pr = prs.get('acme/app#42')!;

    expect(pr.timeline).toEqual([
      { id: 'E1', kind: 'review_requested', actor: 'alice', at: '2026-09-18T09:05:00.000Z', subject: 'acme/infra' },
      { id: 'E2', kind: 'head_ref_force_pushed', actor: 'alice', at: '2026-09-20T09:00:00.000Z', subject: null },
      { id: 'E3', kind: 'added_to_merge_queue', actor: 'trunk-io[bot]', at: '2026-09-20T10:00:00.000Z', subject: null },
    ]);
    expect(pr.checks).toEqual({
      rollup: 'PENDING',
      contexts: [
        { name: 'test', conclusion: 'SUCCESS', completedAt: '2026-09-20T09:10:00.000Z' },
        { name: 'lint', conclusion: null, completedAt: null },
        { name: 'deploy/preview', conclusion: 'FAILURE', completedAt: '2026-09-20T09:05:00.000Z' },
        { name: 'ci/legacy', conclusion: null, completedAt: null },
      ],
    });

    const merged = prs.get('acme/api#8')!;
    expect(merged).toMatchObject({
      state: 'MERGED',
      author: 'dependabot[bot]',
      mergedBy: 'bob',
      mergedAt: '2026-09-17T10:00:00.000Z',
      reviewDecision: 'NONE',
      files: [],
      checks: { rollup: 'NONE', contexts: [] },
    });
  });

  it('splits refs into batches of PR_BATCH_SIZE', async () => {
    const many = Array.from({ length: PR_BATCH_SIZE + 3 }, (_, i) => ({ repo: 'acme/app', number: i + 1 }));
    const fake = new FakeFetch([{ body: { data: {} } }, { body: { data: {} } }]);

    const prs = await new GitHubClient(fakeTokens, fake.fn).fetchPrs(many);

    expect(prs.size).toBe(0);
    expect(fake.requests).toHaveLength(2);
    const queries = fake.requests.map((r) => (r.body as { query: string }).query);
    expect(queries.map((q) => (q.match(/: repository\(/g) ?? []).length)).toEqual([PR_BATCH_SIZE, 3]);
  });

  it('makes no request for an empty list', async () => {
    const fake = new FakeFetch([]);
    expect((await new GitHubClient(fakeTokens, fake.fn).fetchPrs([])).size).toBe(0);
  });

  it('fails the call when a batch returns no data at all', async () => {
    const fake = new FakeFetch([{ body: { data: null, errors: [{ message: 'Something went wrong' }] } }]);
    await expect(new GitHubClient(fakeTokens, fake.fn).fetchPrs(refs)).rejects.toThrow(/Something went wrong/);
  });

  it('fetchPrsPartial lists a failed batch and keeps the others', async () => {
    const many = Array.from({ length: PR_BATCH_SIZE + 1 }, (_, i) => ({ repo: 'acme/app', number: i + 1 }));
    const fake = new FakeFetch([
      { body: { data: null, errors: [{ message: 'Something went wrong' }] } },
      { body: { data: { pr0: { pullRequest: null } } } },
    ]);
    const result = await new GitHubClient(fakeTokens, fake.fn).fetchPrsPartial(many);
    expect(result.errors).toEqual([`${PR_BATCH_SIZE} PRs from acme/app#1: GitHub PR batch query failed: Something went wrong`]);
    expect(result.prs.size).toBe(0);
  });
});

describe('viewer', () => {
  it('returns the login and teams as org/slug, using partial data', async () => {
    const fake = new FakeFetch([
      { body: { data: { viewer: { login: 'viewer' } } } },
      {
        body: {
          data: {
            viewer: {
              login: 'viewer',
              organizations: {
                nodes: [
                  { login: 'acme', teams: { nodes: [{ slug: 'infra' }, { slug: 'devex' }] } },
                  null,
                ],
              },
            },
          },
          errors: [{ message: 'Resource protected by organization SAML enforcement.' }],
        },
      },
    ]);

    const viewer = await new GitHubClient(fakeTokens, fake.fn).viewer();

    expect(viewer).toEqual({ login: 'viewer', teams: ['acme/infra', 'acme/devex'] });
    expect((fake.requests[1]?.body as { variables: unknown }).variables).toEqual({ login: 'viewer' });
  });

  it('returns no teams when the teams query fails outright', async () => {
    const fake = new FakeFetch([
      { body: { data: { viewer: { login: 'viewer' } } } },
      { body: { data: null, errors: [{ message: 'missing read:org scope' }] } },
    ]);
    expect(await new GitHubClient(fakeTokens, fake.fn).viewer()).toEqual({ login: 'viewer', teams: [] });
  });
});

describe('findPrsByBranch', () => {
  const lookups = [
    { repo: 'acme/app', branch: 'alice/base', side: 'head' as const },
    { repo: 'acme/app', branch: 'master', side: 'head' as const },
    { repo: 'acme/app', branch: 'alice/top', side: 'base' as const },
    { repo: 'acme/hidden', branch: 'x', side: 'base' as const },
  ];

  it('asks for PRs in every state by head or base branch, with former bases, one alias per lookup', () => {
    const query = buildBranchQuery(lookups);
    expect(query).toContain('b0: repository(owner: "acme", name: "app") { defaultBranchRef { name } pullRequests(headRefName: "alice/base"');
    expect(query).toContain('b2: repository(owner: "acme", name: "app") { defaultBranchRef { name } pullRequests(baseRefName: "alice/top"');
    expect(query).toContain('states: [OPEN, MERGED, CLOSED]');
    expect(query).toContain('itemTypes: [BASE_REF_CHANGED_EVENT]');
  });

  it('answers in lookup order, drops forks, and finds nothing below the default branch', async () => {
    const node = (number: number, extra: Record<string, unknown> = {}) => ({
      number,
      state: 'OPEN',
      createdAt: '2026-09-10T10:00:00Z',
      mergedAt: null,
      updatedAt: '2026-09-19T10:00:00Z',
      baseRefName: 'master',
      headRefName: `branch-${number}`,
      isCrossRepository: false,
      ...extra,
    });
    const fake = new FakeFetch([
      {
        body: {
          data: {
            b0: { defaultBranchRef: { name: 'master' }, pullRequests: { nodes: [node(10), node(11, { isCrossRepository: true })] } },
            b1: { defaultBranchRef: { name: 'master' }, pullRequests: { nodes: [node(12)] } },
            b2: { defaultBranchRef: { name: 'master' }, pullRequests: { nodes: [node(13, {
                      state: 'MERGED',
                      mergedAt: '2026-09-18T10:00:00Z',
                      baseRefChanges: { nodes: [{ previousRefName: 'alice/older' }, {}, { previousRefName: 'alice/older' }] },
                    })] } },
            b3: null,
          },
        },
      },
    ]);

    const found = await new GitHubClient(fakeTokens, fake.fn).findPrsByBranch(lookups);

    expect(found.map((prs) => prs.map((pr) => pr.ref.number))).toEqual([[10], [], [13], []]);
    expect(found[2]?.[0]).toEqual({
      ref: { repo: 'acme/app', number: 13 },
      state: 'MERGED',
      createdAt: '2026-09-10T10:00:00.000Z',
      mergedAt: '2026-09-18T10:00:00.000Z',
      updatedAt: '2026-09-19T10:00:00.000Z',
      baseRef: 'master',
      headRef: 'branch-13',
      previousBaseRefs: ['alice/older'],
    });
    expect(fake.requests).toHaveLength(1);
  });
});

import { makeComment, makeThreadFor, viewer } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { topicWithPrs } from './testing/topics.ts';

const OTHER_REPO = 'acme/infra';

describe('repo scope', () => {
  it('lists repos with topic counts and keeps only the topics with a PR in the chosen repo', async () => {
    const h = makeHarness();
    const main = reviewRequestedPr(1, { reviewerUsers: [viewer.login] });
    const other = reviewRequestedPr(2, { repo: OTHER_REPO, reviewerUsers: [viewer.login] });
    topicWithPrs(h, 'mixed', [main, other]);
    topicWithPrs(h, 'other-only', [reviewRequestedPr(3, { repo: OTHER_REPO })]);
    await h.engine.sync({ maxAgentCalls: 0 });

    expect(await h.engine.listRepos()).toEqual({
      scope: null,
      topics: 2,
      repos: [
        { repo: OTHER_REPO, topics: 2, prs: 2, quiet: false, selected: false },
        { repo: 'acme/app', topics: 1, prs: 1, quiet: false, selected: false },
      ],
    });

    const overview = await h.engine.setRepoScope('acme/app');
    expect(overview.scope).toBe('acme/app');
    expect(overview.repos.map((entry) => [entry.repo, entry.selected])).toEqual([
      [OTHER_REPO, false],
      ['acme/app', true],
    ]);
    const items = await h.engine.listTopics();
    expect(items.map((item) => item.topic.id)).toEqual(['mixed']);
    // The counts cover the whole topic, the other-repo PR too.
    expect(items[0]?.totalTiles).toBe(2);
    expect(items[0]?.queues.tiers.to_review).toBe(2);
    expect((await h.engine.search('#3')).topics).toEqual([]);
    expect((await h.engine.search('#2')).topics.map((topic) => topic.topicId)).toEqual(['mixed']);
    // The MCP server reads past the chosen repo; the choice itself stays.
    expect((await h.engine.listTopics({ allRepos: true })).map((item) => item.topic.id).sort()).toEqual(['mixed', 'other-only']);
    expect((await h.engine.search('#3', { allRepos: true })).topics.map((topic) => topic.topicId)).toEqual(['other-only']);
    expect((await h.engine.listRepos()).scope).toBe('acme/app');

    // "All repos" again.
    expect((await h.engine.setRepoScope(null)).scope).toBeNull();
    expect((await h.engine.listTopics()).map((item) => item.topic.id).sort()).toEqual(['mixed', 'other-only']);
  });

  it('shows every tile of an opened topic and labels the ones from another repo', async () => {
    const h = makeHarness();
    const main = reviewRequestedPr(1);
    const second = reviewRequestedPr(4);
    const other = reviewRequestedPr(2, { repo: OTHER_REPO });
    topicWithPrs(h, 'mixed', [main, second, other]);
    await h.engine.sync({ maxAgentCalls: 0 });
    const labels = async () => {
      const tiles = (await h.engine.getTopic('mixed'))?.tiles ?? [];
      return Object.fromEntries(tiles.map((view) => [view.prs[0]?.key, view.repoLabel]));
    };

    // All repos: compared against the topic's main repo (most PRs).
    expect(await labels()).toEqual({ [main.key]: null, [second.key]: null, [other.key]: 'infra' });

    await h.engine.setRepoScope(OTHER_REPO);
    expect(await labels()).toEqual({ [main.key]: 'app', [second.key]: 'app', [other.key]: null });
  });

  it('reads an old multi-selection: one repo stays chosen, several become all repos', async () => {
    const h = makeHarness();
    h.store.meta.set('repo_settings', JSON.stringify({ scope: [OTHER_REPO], quiet: [] }));
    expect((await h.engine.listRepos()).scope).toBe(OTHER_REPO);
    h.store.meta.set('repo_settings', JSON.stringify({ scope: [OTHER_REPO, 'acme/app'], quiet: [OTHER_REPO] }));
    const overview = await h.engine.listRepos();
    expect(overview.scope).toBeNull();
    expect(overview.repos).toEqual([{ repo: OTHER_REPO, topics: 0, prs: 0, quiet: true, selected: false }]);
  });
});

describe('quiet repos', () => {
  it('keeps quiet PRs listed but never urgent and out of the queue counts', async () => {
    const h = makeHarness();
    topicWithPrs(h, 'infra', [reviewRequestedPr(2, { repo: OTHER_REPO, reviewerUsers: [viewer.login] })]);
    await h.engine.sync({ maxAgentCalls: 0 });
    const before = (await h.engine.listTopics())[0];
    expect(before).toMatchObject({ group: 'needs_you', urgentUnreadTiles: 1 });
    expect(before?.queues.tiers.to_review).toBe(1);

    const overview = await h.engine.setRepoQuiet(OTHER_REPO, true);
    expect(overview.repos).toEqual([{ repo: OTHER_REPO, topics: 1, prs: 1, quiet: true, selected: false }]);

    const item = (await h.engine.listTopics())[0];
    expect(item).toMatchObject({ group: 'quiet', unreadTiles: 1, urgentUnreadTiles: 0 });
    expect(item?.queues.tiers).toEqual({ needs_reply: 0, mine: 0, team: 0, to_review: 0, team_mentioned: 0, rest: 0 });
    const tile = (await h.engine.getTopic('infra'))?.tiles[0];
    expect(tile).toMatchObject({ quietRepo: true, tier: 'rest', state: { kind: 'unread' } });
    expect(tile?.prs[0]).toMatchObject({ quietRepo: true, tier: 'rest' });

    await h.engine.setRepoQuiet(OTHER_REPO, false);
    expect((await h.engine.listTopics())[0]).toMatchObject({ group: 'needs_you' });
  });

  it('never pings for a quiet repo and never asks the agent', async () => {
    const h = makeHarness();
    const pr = reviewRequestedPr(1, { repo: OTHER_REPO });
    h.reader.addPr(pr, makeThreadFor(pr));
    await h.engine.sync({ maxAgentCalls: 0 });
    await h.engine.setRepoQuiet(OTHER_REPO, true);
    const later = '2026-09-02T12:01:00.000Z';
    const next = {
      ...pr,
      updatedAt: later,
      comments: [makeComment({ id: 'm-1', author: 'bob', body: `@${viewer.login} can you check?`, createdAt: '2026-09-02T11:55:00.000Z' })],
    };
    h.reader.addPr(next, makeThreadFor(next, { updatedAt: later }));
    h.reader.etag = 'etag-2';

    const cycle = await h.engine.pollOnce();

    if (cycle.kind !== 'done') throw new Error('expected a done cycle');
    expect(cycle.pings).toEqual([]);
    expect(h.runner.promptsFor('ping_decision')).toEqual([]);
    expect(h.store.pingDecisions.listRecent(10).map((d) => [d.ping, d.source, d.reason])).toEqual([
      [false, 'rules', 'quiet_repo: quiet repo (let it go stale)'],
    ]);
  });
});

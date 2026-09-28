import { makeComment, makeThreadFor, viewer } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { topicWithPrs } from './testing/topics.ts';

const CHARTS = 'PostHog/example-infra';

describe('repo scope', () => {
  it('lists repos with counts and narrows topics, tiles and search to the scope', async () => {
    const h = makeHarness();
    const main = reviewRequestedPr(1, { reviewerUsers: [viewer.login] });
    const charts = reviewRequestedPr(2, { repo: CHARTS });
    topicWithPrs(h, 'mixed', [main, charts]);
    topicWithPrs(h, 'example-infra-only', [reviewRequestedPr(3, { repo: CHARTS })]);
    await h.engine.sync({ maxAgentCalls: 0 });

    expect(await h.engine.listRepos()).toEqual({
      scope: null,
      repos: [
        { repo: CHARTS, prs: 2, quiet: false, inScope: true },
        { repo: 'PostHog/posthog', prs: 1, quiet: false, inScope: true },
      ],
    });

    const overview = await h.engine.setRepoScope(['PostHog/posthog']);
    expect(overview.scope).toEqual(['PostHog/posthog']);
    expect(overview.repos.map((entry) => [entry.repo, entry.inScope])).toEqual([
      [CHARTS, false],
      ['PostHog/posthog', true],
    ]);
    const items = await h.engine.listTopics();
    expect(items.map((item) => item.topic.id)).toEqual(['mixed']);
    expect(items[0]?.queues.tiers.to_review).toBe(1);
    const detail = await h.engine.getTopic('mixed');
    expect(detail?.tiles.flatMap((view) => view.prs.map((pr) => pr.key))).toEqual([main.key]);
    expect((await h.engine.search('#3')).topics).toEqual([]);

    // An empty selection is "All repos" again.
    expect((await h.engine.setRepoScope([])).scope).toBeNull();
    expect((await h.engine.listTopics()).map((item) => item.topic.id).sort()).toEqual(['example-infra-only', 'mixed']);
  });
});

describe('quiet repos', () => {
  it('keeps quiet PRs listed but never urgent and out of the queue counts', async () => {
    const h = makeHarness();
    topicWithPrs(h, 'example-infra', [reviewRequestedPr(2, { repo: CHARTS, reviewerUsers: [viewer.login] })]);
    await h.engine.sync({ maxAgentCalls: 0 });
    const before = (await h.engine.listTopics())[0];
    expect(before).toMatchObject({ group: 'needs_you', urgentUnreadTiles: 1 });
    expect(before?.queues.tiers.to_review).toBe(1);

    const overview = await h.engine.setRepoQuiet(CHARTS, true);
    expect(overview.repos).toEqual([{ repo: CHARTS, prs: 1, quiet: true, inScope: true }]);

    const item = (await h.engine.listTopics())[0];
    expect(item).toMatchObject({ group: 'quiet', unreadTiles: 1, urgentUnreadTiles: 0 });
    expect(item?.queues.tiers).toEqual({ needs_reply: 0, mine: 0, team: 0, to_review: 0, team_mentioned: 0, rest: 0 });
    const tile = (await h.engine.getTopic('example-infra'))?.tiles[0];
    expect(tile).toMatchObject({ quietRepo: true, tier: 'rest', state: { kind: 'unread' } });
    expect(tile?.prs[0]).toMatchObject({ quietRepo: true, tier: 'rest' });

    await h.engine.setRepoQuiet(CHARTS, false);
    expect((await h.engine.listTopics())[0]).toMatchObject({ group: 'needs_you' });
  });

  it('never pings for a quiet repo and never asks the agent', async () => {
    const h = makeHarness();
    const pr = reviewRequestedPr(1, { repo: CHARTS });
    h.reader.addPr(pr, makeThreadFor(pr));
    await h.engine.sync({ maxAgentCalls: 0 });
    await h.engine.setRepoQuiet(CHARTS, true);
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

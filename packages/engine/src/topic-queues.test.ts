import { makeComment, makePr, makeReview, viewer } from '@code-manager/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { topicWithPrs } from './testing/topics.ts';

function harnessWithTeam() {
  const h = makeHarness();
  h.reader.teams.set('PostHog/team-devex', ['lyra']);
  return h;
}

describe('topic list queues', () => {
  it('counts PRs per tier and lists the people, team first and no bots', async () => {
    const h = harnessWithTeam();
    const review = reviewRequestedPr(1, { reviewerUsers: [viewer.login] });
    const mine = makePr({
      number: 2,
      author: viewer.login,
      reviews: [makeReview({ author: 'ada' }), makeReview({ author: 'lyra' })],
      comments: [makeComment({ author: 'dependabot[bot]' })],
    });
    const merged = makePr({ number: 3, author: 'lyra', state: 'MERGED' });
    topicWithPrs(h, 'queues', [review, mine, merged]);

    await h.engine.sync({ maxAgentCalls: 0 });

    const item = (await h.engine.listTopics()).find((entry) => entry.topic.id === 'queues');
    expect(item?.queues).toEqual({
      tiers: { needs_reply: 0, mine: 1, team: 0, to_review: 1, team_mentioned: 0, rest: 1 },
      byYou: 1,
      byTeam: 0,
    });
    expect(item?.people).toEqual([
      { login: viewer.login, relation: 'you' },
      { login: 'lyra', relation: 'team' },
      { login: 'alice', relation: 'other' },
      { login: 'ada', relation: 'other' },
    ]);
    const detail = await h.engine.getTopic('queues');
    const tiers = Object.fromEntries((detail?.tiles ?? []).map((view) => [view.prs[0]?.key, view.tier]));
    expect(tiers).toEqual({ [review.key]: 'to_review', [mine.key]: 'mine', [merged.key]: 'rest' });
    expect(detail?.tiles.flatMap((view) => view.prs).find((pr) => pr.key === merged.key)?.authorRelation).toBe('team');
    expect(await h.engine.getViewer()).toEqual({ login: viewer.login, teamMembers: ['lyra'] });
  });

  it('keeps a topic calm when every unread tile is merged', async () => {
    const h = harnessWithTeam();
    topicWithPrs(h, 'merged', [reviewRequestedPr(4, { state: 'MERGED' })]);
    topicWithPrs(h, 'open', [reviewRequestedPr(5)]);

    await h.engine.sync({ maxAgentCalls: 0 });

    const items = await h.engine.listTopics();
    expect(items.map((item) => item.topic.id)).toEqual(['open', 'merged']);
    expect(items[0]).toMatchObject({ group: 'needs_you', unreadTiles: 1, urgentUnreadTiles: 1 });
    expect(items[1]).toMatchObject({ group: 'quiet', unreadTiles: 1, urgentUnreadTiles: 0 });
  });
});

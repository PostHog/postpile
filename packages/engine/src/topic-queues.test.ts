import { at, makeComment, makePr, makeReview, makeTimelineItem, viewer } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { readThreadsOnGitHub, topicWithPrs } from './testing/topics.ts';

function harnessWithTeam() {
  const h = makeHarness();
  h.reader.teams.set('acme/team-platform', ['lyra']);
  return h;
}

describe('topic list queues', () => {
  it('counts PRs per tier and shows PR authors as faces, you and your team first', async () => {
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
      tiers: { needs_reply: 0, changes_requested: 0, mine: 1, team: 0, to_review: 1, team_mentioned: 0, rest: 1 },
      byYou: 1,
      byTeam: 0,
      changesAddressed: 0,
    });
    // Authors only: ada reviewed and stays out; alice wrote the review-requested PR.
    expect(item?.people).toEqual([
      { login: viewer.login, relation: 'you' },
      { login: 'lyra', relation: 'team' },
      { login: 'alice', relation: 'other' },
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

  it('does not make a topic urgent for merging your own approved PR, but counts the move', async () => {
    const h = harnessWithTeam();
    const approved = makePr({ number: 6, author: viewer.login, reviewDecision: 'APPROVED', reviews: [makeReview({ author: 'lyra' })] });
    topicWithPrs(h, 'approved', [approved]);

    await h.engine.sync({ maxAgentCalls: 0 });
    h.store.events.markSeen(h.store.events.listForPr(approved.key).map((event) => event.id), at(6));
    readThreadsOnGitHub(h, [approved]);

    const detail = await h.engine.getTopic('approved');
    expect(detail?.tiles[0]).toMatchObject({ state: { kind: 'open' }, turn: { kind: 'you', what: 'Merge, it is approved' } });
    const item = (await h.engine.listTopics()).find((entry) => entry.topic.id === 'approved');
    expect(item).toMatchObject({ group: 'quiet', yourMoves: [{ move: 'merge', text: 'Merge, it is approved' }] });
  });

  it('lists your moves most urgent first, whatever the tile order', async () => {
    const h = harnessWithTeam();
    const approved = makePr({ number: 7, author: viewer.login, reviewDecision: 'APPROVED', reviews: [makeReview({ author: 'lyra' })] });
    const review = reviewRequestedPr(8, { author: 'ada', reviewerUsers: [viewer.login] });
    topicWithPrs(h, 'moves', [approved, review]);

    await h.engine.sync({ maxAgentCalls: 0 });

    const item = (await h.engine.listTopics()).find((entry) => entry.topic.id === 'moves');
    expect(item?.yourMoves.map((entry) => entry.move)).toEqual(['review', 'merge']);
  });

  it('counts a re-request without a push as addressed, so Changes you requested sorts it first', async () => {
    const h = harnessWithTeam();
    // You requested changes on the head; ada asked you again without pushing.
    const changes = makeReview({ author: viewer.login, state: 'CHANGES_REQUESTED', submittedAt: at(10) });
    const reRequested = makePr({
      number: 12,
      author: 'ada',
      reviews: [changes],
      reviewerUsers: [viewer.login],
      timeline: [makeTimelineItem({ id: 'rr-12', actor: 'ada', at: at(20) })],
      updatedAt: at(20),
    });
    const waiting = makePr({ number: 13, author: 'ada', reviews: [{ ...changes, id: 'r13' }], updatedAt: at(10) });
    topicWithPrs(h, 'rerequested', [reRequested]);
    topicWithPrs(h, 'waiting', [waiting]);

    await h.engine.sync({ maxAgentCalls: 0 });

    const items = await h.engine.listTopics();
    const queues = (id: string) => items.find((entry) => entry.topic.id === id)?.queues;
    expect(queues('rerequested')).toMatchObject({ tiers: { changes_requested: 1 }, changesAddressed: 1 });
    expect(queues('waiting')).toMatchObject({ tiers: { changes_requested: 1 }, changesAddressed: 0 });
    const tile = (await h.engine.getTopic('rerequested'))?.tiles[0];
    expect(tile?.turn).toMatchObject({ kind: 'you', move: 're_review', what: 'Re-review, ada asked' });
  });

  it('keeps pulled-in stack layers out of the queue counts and tiers', async () => {
    const h = harnessWithTeam();
    const below = makePr({ number: 10, author: 'lyra', baseRef: 'master', headRef: 'l10' });
    const pinged = reviewRequestedPr(11, { author: 'lyra', baseRef: 'l10', headRef: 'l11' });
    topicWithPrs(h, 'stack', [pinged]);
    h.reader.addStackPr(below);

    await h.engine.sync({ maxAgentCalls: 0 });

    const item = (await h.engine.listTopics()).find((entry) => entry.topic.id === 'stack');
    expect(item?.queues).toEqual({
      tiers: { needs_reply: 0, changes_requested: 0, mine: 0, team: 1, to_review: 0, team_mentioned: 0, rest: 0 },
      byYou: 0,
      byTeam: 1,
      changesAddressed: 0,
    });
    const stack = (await h.engine.getTopic('stack'))?.tiles.find((view) => view.tile.kind === 'stack');
    expect(stack?.prs.map((pr) => [pr.key, pr.provenance.kind, pr.tier])).toEqual([
      [below.key, 'pulled_in', 'rest'],
      [pinged.key, 'pinged', 'team'],
    ]);
  });
});

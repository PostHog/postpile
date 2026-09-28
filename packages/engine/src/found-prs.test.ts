import { at, makeComment, makePr, makeThreadFor, viewer } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { makeTopic } from './testing/topics.ts';

/** A review-requested PR that is not in the inbox, placed in topic `t`. */
function foundInTopic(h: Harness) {
  const pr = reviewRequestedPr(7, { reviewerUsers: [viewer.login] });
  h.reader.addFoundPr(pr, 'review_requested', 'review requested from you');
  h.store.topics.create(makeTopic('t'));
  h.store.memberships.assign({ prKey: pr.key, topicId: 't', assignedBy: 'user', reason: '', createdAt: at(0) });
  return pr;
}

describe('found PRs', () => {
  it('finds a PR outside the inbox once per sync, as a calm tile whose turn lifts the topic', async () => {
    const h = makeHarness();
    const pr = foundInTopic(h);

    const report = await h.engine.sync({ maxAgentCalls: 0 });

    expect(report.prsFound).toBe(1);
    expect(h.reader.findCalls).toEqual([[viewer.teams, '2026-08-26']]);
    const tile = (await h.engine.getTopic('t'))?.tiles[0];
    expect(tile?.prs[0]).toMatchObject({ key: pr.key, provenance: { kind: 'found', via: 'review_requested' }, why: 'RV', tier: 'to_review', unseenLoudEvents: 0 });
    // Its review request event is loud, but a found PR never makes the tile unread.
    expect(tile?.state.kind).toBe('open');
    expect(tile?.turn.kind).toBe('you');
    expect((await h.engine.listTopics())[0]).toMatchObject({ group: 'needs_you', unreadTiles: 0, queues: { tiers: { to_review: 1 } } });
  });

  it('skips found PRs that did not move since the last fetch', async () => {
    const h = makeHarness();
    foundInTopic(h);
    await h.engine.sync({ maxAgentCalls: 0 });
    const fetchesBefore = h.reader.fetchedRefs.length;

    const report = await h.engine.sync({ maxAgentCalls: 0 });

    expect(report.prsFound).toBe(0);
    expect(h.reader.fetchedRefs.length).toBe(fetchesBefore);
    expect(h.reader.findCalls).toHaveLength(2);
  });

  it('turns pinged, and can be unread, once a notification thread appears', async () => {
    const h = makeHarness();
    const pr = foundInTopic(h);
    await h.engine.sync({ maxAgentCalls: 0 });

    const next = { ...pr, updatedAt: at(50), comments: [makeComment({ id: 'q', author: 'bob', body: `@${viewer.login} ok?`, createdAt: at(40) })] };
    h.reader.addPr(next, makeThreadFor(next));
    h.reader.etag = 'etag-2';
    await h.engine.sync({ maxAgentCalls: 0 });

    const tile = (await h.engine.getTopic('t'))?.tiles[0];
    expect(tile?.prs[0]?.provenance.kind).toBe('pinged');
    expect(tile?.state.kind).toBe('unread');
  });

  it('lands in Unsorted without a topic, and the poll never asks the finder', async () => {
    const h = makeHarness();
    const own = makePr({ number: 8, author: viewer.login });
    h.reader.addFoundPr(own, 'own_open', 'your open PR');
    await h.engine.sync({ maxAgentCalls: 0 });

    const unsorted = await h.engine.getTopic('unsorted');
    expect(unsorted?.tiles.map((view) => [view.prs[0]?.key, view.prs[0]?.why])).toEqual([[own.key, 'AU']]);
    h.reader.etag = 'etag-2';
    await h.engine.pollOnce();
    expect(h.reader.findCalls).toHaveLength(1);
  });

  it('reports a failed finder request and goes on', async () => {
    const h = makeHarness();
    h.reader.findError = new Error('boom');
    const pr = reviewRequestedPr(1);
    h.reader.addPr(pr, makeThreadFor(pr));
    const report = await h.engine.sync({ maxAgentCalls: 0 });
    expect(report.errors).toEqual(['found PRs: boom']);
    expect(report.prsFetched).toBe(1);
  });

  it('keeps a found PR in a quiet repo out of the urgency', async () => {
    const h = makeHarness();
    const pr = reviewRequestedPr(9, { repo: 'acme/infra', reviewerUsers: [viewer.login] });
    h.reader.addFoundPr(pr, 'review_requested', 'review requested from you');
    await h.engine.setRepoQuiet('acme/infra', true);
    await h.engine.sync({ maxAgentCalls: 0 });
    expect((await h.engine.listTopics())[0]).toMatchObject({ group: 'quiet', queues: { tiers: { to_review: 0 } } });
  });
});

import type { Pr } from '@postpile/core';
import { at, makeComment, makeThreadFor, makeTimelineItem, viewer } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { topicWithPrs } from './testing/topics.ts';

/** Four days after the fixture PRs' activity: past the 3 quiet days. */
const FOUR_DAYS_LATER = new Date('2026-09-05T12:00:00Z');
/** Two days after the fixture PRs' activity: not quiet long enough. */
const TWO_DAYS_LATER = new Date('2026-09-03T12:00:00Z');

function mergedPr(number: number): Pr {
  return reviewRequestedPr(number, { state: 'MERGED', mergedAt: at(5), mergedBy: 'alice' });
}

/** Synced once, then every event marked seen: nothing left to read. */
async function syncedAndRead(h: Harness, prs: Pr[]): Promise<void> {
  topicWithPrs(h, 'depot', prs);
  await h.engine.sync({ maxAgentCalls: 0 });
  const eventIds = prs.flatMap((pr) => h.store.events.listForPr(pr.key).map((e) => e.id));
  h.store.events.markSeen(eventIds, at(6));
}

describe('Engine.sync retires finished topics', () => {
  it('retires a topic whose PRs are all merged, quiet for 3 days, with nothing unread', async () => {
    const h = makeHarness({ now: () => FOUR_DAYS_LATER });
    await syncedAndRead(h, [mergedPr(1)]);

    const report = await h.engine.sync({ maxAgentCalls: 0 });

    expect(report.topicsRetired).toBe(1);
    expect(h.store.topics.get('depot')?.status).toBe('retired');
    expect(await h.engine.listTopics()).toEqual([]);
    expect(await h.engine.listFinishedTopics()).toEqual([
      { id: 'depot', name: 'depot', area: null, retiredAt: FOUR_DAYS_LATER.toISOString(), prCount: 1 },
    ]);
    // A later rename does not move the retire time.
    h.store.topics.rename('depot', 'Depot runners', '2026-09-20T00:00:00.000Z');
    expect((await h.engine.listFinishedTopics())[0]?.retiredAt).toBe(FOUR_DAYS_LATER.toISOString());
    // Opened from the Finished drawer, the topic still shows its tile.
    expect((await h.engine.getTopic('depot'))?.tiles.map((view) => view.tile.id)).toEqual([`pr:${mergedPr(1).key}`]);
  });

  it('keeps a topic while a merge without your review is unseen, and retires it once read', async () => {
    const h = makeHarness({ now: () => FOUR_DAYS_LATER });
    const pr = reviewRequestedPr(1, {
      state: 'MERGED',
      mergedAt: at(5),
      mergedBy: 'alice',
      timeline: [
        makeTimelineItem({ id: 't1', kind: 'review_requested', actor: 'alice', subject: viewer.login, at: at(1) }),
        makeTimelineItem({ id: 't2', kind: 'merged', actor: 'alice', subject: null, at: at(5) }),
      ],
    });
    topicWithPrs(h, 'depot', [pr]);
    await h.engine.sync({ maxAgentCalls: 0 });
    const events = h.store.events.listForPr(pr.key);
    const merge = events.find((e) => e.kind === 'merged_without_review');
    expect(merge?.ruleLoudness).toBe('quiet');
    h.store.events.markSeen(events.filter((e) => e !== merge).map((e) => e.id), at(6));

    const kept = await h.engine.sync({ maxAgentCalls: 0 });
    expect(kept.topicsRetired).toBe(0);
    const tile = (await h.engine.getTopic('depot'))?.tiles[0];
    expect(tile?.state.kind).toBe('open');
    expect((await h.engine.listTopics())[0]).toMatchObject({ unreadTiles: 0, unseenMergeTiles: 1 });

    h.store.events.markSeen([merge!.id], at(7));
    const retired = await h.engine.sync({ maxAgentCalls: 0 });
    expect(retired.topicsRetired).toBe(1);
  });

  it('glances a PR merged without your review while the merge is unseen, and a Not yours glance settles it', async () => {
    const h = makeHarness({ now: () => FOUR_DAYS_LATER });
    const pr = reviewRequestedPr(1, {
      state: 'MERGED',
      mergedAt: at(5),
      mergedBy: 'alice',
      timeline: [
        makeTimelineItem({ id: 't1', kind: 'review_requested', actor: 'alice', subject: viewer.login, at: at(1) }),
        makeTimelineItem({ id: 't2', kind: 'merged', actor: 'alice', subject: null, at: at(5) }),
      ],
    });
    topicWithPrs(h, 'depot', [pr]);
    h.agent.answerGlances((input) => {
      const all = h.agent.allGlances(input);
      return { ...all, glances: all.glances.map((glance) => ({ ...glance, verdict: 'NOT_YOURS' as const })) };
    });

    await h.engine.sync({ agentJobs: ['glances'] });

    expect(h.agent.glanceInputs.flatMap((input) => input.items.map((item) => item.pr.key))).toContain(pr.key);
    const events = h.store.events.listForPr(pr.key);
    h.store.events.markSeen(events.filter((e) => e.kind !== 'merged_without_review').map((e) => e.id), at(6));
    expect(h.store.glances.get(pr.key)?.verdict).toBe('NOT_YOURS');
    const tile = (await h.engine.getTopic('depot'))?.tiles[0];
    expect(tile?.state.kind).toBe('done');
  });

  it('keeps a topic with an open PR', async () => {
    const h = makeHarness({ now: () => FOUR_DAYS_LATER });
    await syncedAndRead(h, [mergedPr(1), reviewRequestedPr(2)]);

    const report = await h.engine.sync({ maxAgentCalls: 0 });

    expect(report.topicsRetired).toBe(0);
    expect(h.store.topics.get('depot')?.status).toBe('active');
  });

  it('keeps a topic with an unread tile', async () => {
    const h = makeHarness({ now: () => FOUR_DAYS_LATER });
    topicWithPrs(h, 'depot', [mergedPr(1)]);

    await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.store.topics.get('depot')?.status).toBe('active');
  });

  it('keeps a topic with a snoozed tile', async () => {
    const h = makeHarness({ now: () => FOUR_DAYS_LATER });
    const pr = mergedPr(1);
    await syncedAndRead(h, [pr]);
    h.store.snoozes.put({ prKey: pr.key, condition: { kind: 'until_time', until: '2099-01-01T00:00:00.000Z' }, since: at(6) });

    await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.store.topics.get('depot')?.status).toBe('active');
  });

  it('keeps a topic that has been quiet for less than 3 days', async () => {
    const h = makeHarness({ now: () => TWO_DAYS_LATER });
    await syncedAndRead(h, [mergedPr(1)]);

    await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.store.topics.get('depot')?.status).toBe('active');
  });

  it('brings a retired topic back when a new event arrives, and keeps it while unread', async () => {
    let now = FOUR_DAYS_LATER;
    const h = makeHarness({ now: () => now });
    const pr = mergedPr(1);
    await syncedAndRead(h, [pr]);
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.store.topics.get('depot')?.status).toBe('retired');

    // A day later bob mentions the viewer on the merged PR.
    now = new Date('2026-09-06T12:00:00Z');
    const mentionAt = '2026-09-06T11:00:00.000Z';
    const mention = { ...pr, comments: [makeComment({ id: 'c5', author: 'bob', body: `@${viewer.login} one more thing`, createdAt: mentionAt })] };
    h.reader.addPr(mention, makeThreadFor(mention, { reason: 'mention', updatedAt: mentionAt }));
    h.reader.etag = 'etag-2';
    const report = await h.engine.sync({ maxAgentCalls: 0 });

    expect(report.topicsRetired).toBe(0);
    expect(h.store.topics.get('depot')?.status).toBe('active');
    expect(await h.engine.listFinishedTopics()).toEqual([]);
  });

  it('keeps a retired topic retired when the agent turns the new event quiet', async () => {
    let now = FOUR_DAYS_LATER;
    const h = makeHarness({ now: () => now });
    const pr = mergedPr(1);
    await syncedAndRead(h, [pr]);
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.store.topics.get('depot')?.status).toBe('retired');
    h.agent.answerEvents((input) =>
      input.items.flatMap((item) => item.events.map((event) => ({ eventId: event.id, loudness: 'quiet' as const, reason: 'thanks only' }))),
    );

    now = new Date('2026-09-06T12:00:00Z');
    const mentionAt = '2026-09-06T11:00:00.000Z';
    const mention = { ...pr, comments: [makeComment({ id: 'c5', author: 'bob', body: `@${viewer.login} thanks!`, createdAt: mentionAt })] };
    h.reader.addPr(mention, makeThreadFor(mention, { reason: 'mention', updatedAt: mentionAt }));
    h.reader.etag = 'etag-2';
    await h.engine.sync({ agentJobs: ['events'] });

    expect(h.agent.eventInputs.map((input) => input.topic?.id)).toContain('depot');
    expect(h.store.topics.get('depot')?.status).toBe('retired');
    expect(h.store.topics.get('depot')?.retiredAt).toBe(FOUR_DAYS_LATER.toISOString());
  });
});

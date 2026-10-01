import type { Pr } from '@postpile/core';
import { at, makeComment, makeThreadFor, makeTimelineItem, viewer } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { readThreadsOnGitHub, topicWithPrs } from './testing/topics.ts';

/** Days after the fixture PRs' activity (2026-09-01): past the 2 quiet days, or not. */
const FOUR_DAYS_LATER = new Date('2026-09-05T12:00:00Z');
const TWO_DAYS_LATER = new Date('2026-09-03T12:00:00Z');
const ONE_DAY_LATER = new Date('2026-09-02T12:00:00Z');

function mergedPr(number: number): Pr {
  return reviewRequestedPr(number, { state: 'MERGED', mergedAt: at(5), mergedBy: 'alice' });
}

/** Synced once, then every event marked seen and every thread read on GitHub: nothing left to read. */
async function syncedAndRead(h: Harness, prs: Pr[]): Promise<void> {
  topicWithPrs(h, 'depot', prs);
  await h.engine.sync({ maxAgentCalls: 0 });
  const eventIds = prs.flatMap((pr) => h.store.events.listForPr(pr.key).map((e) => e.id));
  h.store.events.markSeen(eventIds, at(6));
  readThreadsOnGitHub(h, prs);
}

describe('Engine.sync retires finished topics', () => {
  it('retires a topic whose PRs are all merged, quiet for 2 days, with nothing unread', async () => {
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
    readThreadsOnGitHub(h, [pr]);

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
    readThreadsOnGitHub(h, [pr]);
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

  it('retires a topic whose merged PR still has a snooze stored: the merge ended it', async () => {
    const h = makeHarness({ now: () => FOUR_DAYS_LATER });
    const pr = mergedPr(1);
    await syncedAndRead(h, [pr]);
    h.store.snoozes.put({ prKey: pr.key, condition: { kind: 'until_time', until: '2099-01-01T00:00:00.000Z' }, since: at(6) });

    await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.store.topics.get('depot')?.status).toBe('retired');
  });

  it('keeps a topic that has been quiet for less than 2 days', async () => {
    const h = makeHarness({ now: () => ONE_DAY_LATER });
    await syncedAndRead(h, [mergedPr(1)]);

    await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.store.topics.get('depot')?.status).toBe('active');
  });

  it('does not let bot comments after the merge hold a finished topic back', async () => {
    const h = makeHarness({ now: () => TWO_DAYS_LATER });
    const deployedAt = '2026-09-03T10:00:00.000Z';
    const pr = { ...mergedPr(1), comments: [makeComment({ id: 'c9', author: 'deploy-bot[bot]', body: 'Deployed to production', createdAt: deployedAt })] };
    await syncedAndRead(h, [pr]);

    await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.store.events.listForPr(pr.key).some((event) => event.isBot && event.at === deployedAt)).toBe(true);
    expect(h.store.topics.get('depot')?.status).toBe('retired');
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

  it('keeps a topic whose PRs are all merged and seen while a thread is unread on GitHub', async () => {
    const h = makeHarness({ now: () => FOUR_DAYS_LATER, writesEnabled: false });
    topicWithPrs(h, 'depot', [mergedPr(1)]);
    await h.engine.sync({ maxAgentCalls: 0 });
    h.store.events.markSeen(h.store.events.listForPr(mergedPr(1).key).map((e) => e.id), at(6));

    const report = await h.engine.sync({ maxAgentCalls: 0 });

    expect(report.topicsRetired).toBe(0);
    expect((await h.engine.getTopic('depot'))?.tiles[0]?.state).toMatchObject({ kind: 'unread', loud: false });
  });

  it('brings back a retired topic whose thread is unread on GitHub, without a new event', async () => {
    const h = makeHarness({ now: () => FOUR_DAYS_LATER, writesEnabled: false });
    const pr = mergedPr(1);
    await syncedAndRead(h, [pr]);
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.store.topics.get('depot')?.status).toBe('retired');

    // Retired by an older build while its thread was unread on GitHub.
    h.reader.threads = h.reader.threads.map((thread) => ({ ...thread, unread: true }));
    h.reader.etag = 'etag-2';
    await h.engine.pollOnce();

    expect(h.store.topics.get('depot')?.status).toBe('active');
  });

  it('keeps a retired topic retired when only a bot turned its thread unread, and brings it back for a person', async () => {
    let now = FOUR_DAYS_LATER;
    const h = makeHarness({ now: () => now });
    const pr = mergedPr(1);
    await syncedAndRead(h, [pr]);
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.store.topics.get('depot')?.status).toBe('retired');
    const readAt = h.store.notifications.getByPrKeys([pr.key]).get(pr.key)!.lastReadAt!;

    // A deploy bot comments on the merged PR: the next full sync clears that by rule.
    now = new Date('2026-09-06T12:00:00Z');
    const botAt = '2026-09-06T11:00:00.000Z';
    const withBot = { ...pr, comments: [makeComment({ id: 'c-bot', author: 'vercel[bot]', body: 'Preview deployed', createdAt: botAt })], updatedAt: botAt };
    h.reader.addPr(withBot, makeThreadFor(withBot, { lastReadAt: readAt, updatedAt: botAt }));
    h.reader.etag = 'etag-2';
    await h.engine.pollOnce();
    expect(h.store.topics.get('depot')?.status).toBe('retired');

    // Half an hour later a person comments: that comes back.
    now = new Date('2026-09-06T12:30:00Z');
    const humanAt = '2026-09-06T12:20:00.000Z';
    const withHuman = { ...withBot, comments: [...withBot.comments, makeComment({ id: 'c-bob', author: 'bob', body: 'Follow-up in #2', createdAt: humanAt })], updatedAt: humanAt };
    h.reader.addPr(withHuman, makeThreadFor(withHuman, { lastReadAt: readAt, updatedAt: humanAt }));
    h.reader.etag = 'etag-3';
    await h.engine.pollOnce();
    expect(h.store.topics.get('depot')?.status).toBe('active');
  });

  it('brings a retired topic back when the quiet read that would clear its thread fails', async () => {
    let now = FOUR_DAYS_LATER;
    const h = makeHarness({ now: () => now });
    const pr = mergedPr(1);
    await syncedAndRead(h, [pr]);
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.store.topics.get('depot')?.status).toBe('retired');
    const readAt = h.store.notifications.getByPrKeys([pr.key]).get(pr.key)!.lastReadAt!;

    now = new Date('2026-09-06T12:00:00Z');
    const botAt = '2026-09-06T11:00:00.000Z';
    const withBot = { ...pr, comments: [makeComment({ id: 'c-bot', author: 'vercel[bot]', body: 'Preview deployed', createdAt: botAt })], updatedAt: botAt };
    h.reader.addPr(withBot, makeThreadFor(withBot, { lastReadAt: readAt, updatedAt: botAt }));
    h.reader.etag = 'etag-2';
    h.writer.markThreadRead = async () => {
      throw new Error('GitHub said 502');
    };
    await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.store.notifications.getByPrKeys([pr.key]).get(pr.key)?.unread).toBe(true);
    expect(h.store.topics.get('depot')?.status).toBe('active');
  });

  it('brings a retired topic back while the thread of a new event is unread, also when the agent turns the event quiet', async () => {
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
    // The agent's quiet brings nothing back by loudness, but the mention's thread is unread on GitHub.
    expect(h.store.topics.get('depot')?.status).toBe('active');

    // Read on GitHub, it retires again once the topic is quiet.
    readThreadsOnGitHub(h, [mention]);
    h.store.events.markSeen(h.store.events.listForPr(pr.key).map((e) => e.id), mentionAt);
    now = new Date('2026-09-10T12:00:00Z');
    h.reader.etag = 'etag-3';
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.store.topics.get('depot')?.status).toBe('retired');
  });

  it('offers Archive now on a topic with nothing left before its quiet days are up', async () => {
    const h = makeHarness({ now: () => ONE_DAY_LATER });
    await syncedAndRead(h, [mergedPr(1)]);
    await h.engine.sync({ maxAgentCalls: 0 });
    const box = (await h.engine.getTopic('depot'))?.archive;
    expect(box?.state).toBe('ready');
    expect(box!.at > ONE_DAY_LATER.toISOString()).toBe(true);

    const result = await h.engine.archiveTopic('depot');

    expect(result.ok).toBe(true);
    expect(h.store.topics.get('depot')?.status).toBe('retired');
    expect((await h.engine.getTopic('depot'))?.archive).toEqual({ state: 'archived', at: ONE_DAY_LATER.toISOString(), until: '2026-10-02T12:00:00.000Z' });
  });

  it('refuses Archive now while a PR is open, and shows no box', async () => {
    const h = makeHarness({ now: () => ONE_DAY_LATER });
    await syncedAndRead(h, [reviewRequestedPr(1)]);

    expect((await h.engine.getTopic('depot'))?.archive).toBeNull();
    expect((await h.engine.archiveTopic('depot')).ok).toBe(false);
    expect(h.store.topics.get('depot')?.status).toBe('active');
  });
});

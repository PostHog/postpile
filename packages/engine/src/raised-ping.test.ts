import type { Pr } from '@postpile/core';
import { at, makeCommit, makePr, makeReview, makeThreadFor, viewer } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness, NOW, type Harness } from './testing/fakes.ts';
import { topicWithPrs } from './testing/topics.ts';

// The tile is snoozed at NOW (12:00); the new activity comes after that, so it can wake the snooze.
const PUSHED = '2026-09-02T12:02:00.000Z';
const THREAD_MOVED = '2026-09-02T12:03:00.000Z';

/** alice's PR, approved by the viewer on its first commit. */
function approvedPr(): Pr {
  return makePr({
    number: 1,
    commits: [makeCommit({ oid: 'c1', committedAt: at(5) })],
    reviews: [makeReview({ author: viewer.login, state: 'APPROVED', commitOid: 'c1', submittedAt: at(20) })],
    updatedAt: at(21),
  });
}

/** A bot pushes after the viewer's approval (quiet by rule), and no person says a word: the news is bot-only. */
function botPushAfterApproval(h: Harness, pr: Pr): void {
  const next: Pr = {
    ...pr,
    commits: [...pr.commits, makeCommit({ oid: 'c2', author: 'renovate[bot]', headline: 'bump the runner image', committedAt: PUSHED })],
    updatedAt: THREAD_MOVED,
  };
  h.reader.addPr(next, makeThreadFor(next, { updatedAt: THREAD_MOVED }));
  h.reader.etag = 'etag-2';
}

function pushEventId(h: Harness, pr: Pr): string {
  return h.store.events.listForPr(pr.key).find((event) => event.kind === 'commits_after_approval')!.id;
}

/** The events agent raises the bot's push: it changes what the viewer approved. */
function raisePush(h: Harness, eventId: string): void {
  h.agent.answerEvents(() => [{ eventId, loudness: 'loud', reason: 'changes the approved runner image' }]);
  h.runner.answer('ping_decision', {
    decisions: [{ id: 'thread-1', ping: true, title: 'New commits after your approval', body: 'The runner image changed.', reason: 'changes what you approved' }],
  });
}

async function tileState(h: Harness): Promise<string | undefined> {
  return (await h.engine.getTopic('depot'))?.tiles[0]?.state.kind;
}

describe('pings for events the events agent raised after the poll', () => {
  it('wakes the snoozed tile and pings once when a quiet bot push is raised to loud', async () => {
    let clock = NOW;
    const h = makeHarness({ now: () => clock });
    const pr = approvedPr();
    topicWithPrs(h, 'depot', [pr]);
    await h.engine.sync({ maxAgentCalls: 0 });
    h.store.events.markSeen(h.store.events.listForPr(pr.key).map((event) => event.id), NOW.toISOString());
    await h.engine.snooze(`pr:${pr.key}`, { kind: 'until_time', until: '2099-01-01T00:00:00.000Z' });

    // The poll sees the push while it is quiet: the tile stays snoozed and nothing pings.
    botPushAfterApproval(h, pr);
    clock = new Date('2026-09-02T12:05:00.000Z');
    const polled = await h.engine.pollOnce();
    expect(polled).toMatchObject({ kind: 'done', prsUpdated: 1, pings: [] });
    expect(h.store.pingDecisions.listRecent(1)[0]).toMatchObject({ ping: false, source: 'rules', reason: 'snoozed: tile snoozed' });
    expect(await tileState(h)).toBe('snoozed');

    // The next full sync's events agent raises it: the tile wakes, and the ping goes out with the next poll cycle.
    raisePush(h, pushEventId(h, pr));
    clock = new Date('2026-09-02T12:10:00.000Z');
    await h.engine.sync({ maxAgentCalls: 50 });
    expect(await tileState(h)).toBe('unread');
    const cycle = await h.engine.pollOnce();
    expect(cycle.kind === 'done' ? cycle.pings : []).toEqual([
      {
        title: 'New commits after your approval',
        body: 'The runner image changed.',
        target: { topicId: 'depot', tileId: `pr:${pr.key}`, prKey: pr.key },
      },
    ]);
    expect(h.store.pingDecisions.listRecent(1)[0]).toMatchObject({ ping: true, source: 'agent', prKey: pr.key });

    // The events agent judges the push again (cursor and override reset): the thread pinged since, so nothing pings twice.
    h.store.events.setOverride(pushEventId(h, pr), null);
    h.store.db.prepare("DELETE FROM cursor WHERE kind = 'classify'").run();
    raisePush(h, pushEventId(h, pr));
    clock = new Date('2026-09-02T12:15:00.000Z');
    await h.engine.sync({ maxAgentCalls: 50 });
    const again = await h.engine.pollOnce();
    expect(again).toMatchObject({ kind: 'done', pings: [] });
    expect(h.runner.promptsFor('ping_decision')).toHaveLength(1);
  });
});

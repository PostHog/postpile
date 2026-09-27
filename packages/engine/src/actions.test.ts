import { UNDO_WINDOW_MS, type Pr, type Topic } from '@code-manager/core';
import { at, makeThreadFor } from '@code-manager/core/fixtures';
import { describe, expect, it } from 'vitest';
import { UNSORTED_TOPIC_ID } from './board.ts';
import { makeHarness, type Harness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';

const pr = reviewRequestedPr(1);
const tileId = `pr:${pr.key}`;

function topic(id: string): Topic {
  return { id, name: id, summary: '', summaryInputHash: null, tailoring: '', driver: null, userRole: 'reviewer', status: 'active', createdAt: at(0), updatedAt: at(0) };
}

async function synced(): Promise<Harness> {
  const h = makeHarness();
  h.reader.addPr(pr, makeThreadFor(pr));
  await h.engine.sync({ maxAgentCalls: 0 });
  return h;
}

/** Lets the queued send (and its awaits) run after the fake timer fired. */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** pr and a second PR in topic "depot", grouped by the agent into set s1. */
async function syncedWithPairSet(): Promise<{ h: Harness; other: Pr }> {
  const h = await synced();
  h.store.topics.create(topic('depot'));
  const other = reviewRequestedPr(2);
  h.store.prs.upsert(other, at(0));
  for (const key of [pr.key, other.key]) {
    h.store.memberships.assign({ prKey: key, topicId: 'depot', assignedBy: 'agent', reason: '', createdAt: at(0) });
  }
  h.store.sets.save({
    id: 's1',
    topicId: 'depot',
    title: 'Pair',
    take: '',
    members: [{ prKey: pr.key, reason: 'a' }, { prKey: other.key, reason: 'b' }],
    removedKeys: [],
    status: 'active',
    inputHash: 'h',
    createdAt: at(0),
    updatedAt: at(0),
  });
  return { h, other };
}

async function tileState(h: Harness, topicId = UNSORTED_TOPIC_ID): Promise<string | undefined> {
  return (await h.engine.getTopic(topicId))?.tiles.find((t) => t.tile.id === tileId)?.state.kind;
}

describe('markRead and undo', () => {
  it('turns the tile done at once and sends the GitHub mark-read only after the undo window', async () => {
    const h = await synced();

    const result = await h.engine.markRead(tileId);

    expect(result.ok).toBe(true);
    expect(result.undoToken).not.toBeNull();
    expect(await tileState(h)).toBe('done');
    expect(h.writer.calls).toEqual([]);
    h.timers.advance(UNDO_WINDOW_MS);
    await settle();
    expect(h.writer.calls).toEqual(['markThreadRead thread-1']);
    expect(h.store.notifications.list()[0]?.lastReadAt).toBe(pr.updatedAt);
  });

  it('leaves a thread unread on GitHub when it moved after the last sync', async () => {
    const h = await synced();
    // Someone mentions the user after the sync; GitHub bumps the thread.
    h.reader.addPr(pr, makeThreadFor(pr, { updatedAt: '2026-09-02T13:00:00.000Z' }));
    h.reader.etag = 'etag-2';

    await h.engine.markRead(tileId);
    h.timers.advance(UNDO_WINDOW_MS);
    await settle();

    expect(h.writer.calls).toEqual([]);
    expect(h.store.notifications.list()[0]?.unread).toBe(true);
    const report = await h.engine.sync({ maxAgentCalls: 0 });
    expect(report.errors).toEqual([expect.stringContaining('left notification thread-1 unread')]);
    expect(report.prsFetched).toBe(1);
  });

  it('undo inside the window restores unread and never calls GitHub', async () => {
    const h = await synced();
    const { undoToken } = await h.engine.markRead(tileId);

    const undone = await h.engine.undo(undoToken);

    expect(undone.ok).toBe(true);
    expect(await tileState(h)).toBe('unread');
    h.timers.advance(UNDO_WINDOW_MS * 2);
    expect(h.writer.calls).toEqual([]);
  });

  it('undo after the window reports that it is too late', async () => {
    const h = await synced();
    const { undoToken } = await h.engine.markRead(tileId);
    h.timers.advance(UNDO_WINDOW_MS);

    expect((await h.engine.undo(undoToken)).ok).toBe(false);
  });

  it('flushPendingWrites sends queued mark-reads right away', async () => {
    const h = await synced();
    await h.engine.markRead(tileId);

    await h.engine.flushPendingWrites();

    expect(h.writer.calls).toEqual(['markThreadRead thread-1']);
    expect(h.store.notifications.list()[0]?.unread).toBe(false);
  });
});

describe('approve', () => {
  it('approves the synced head on GitHub, records it and clears the unread state', async () => {
    const h = await synced();

    const result = await h.engine.approve(pr.key);

    expect(result.ok).toBe(true);
    expect(h.writer.calls).toEqual(['approvePr PostHog/posthog#1@head']);
    expect(h.store.userPrStates.get(pr.key)?.approvedCommitOid).toBe('head');
    expect(await tileState(h)).toBe('done');
  });

  it('refuses PRs that are not open', async () => {
    const h = makeHarness();
    const merged = reviewRequestedPr(2, { state: 'MERGED' });
    h.reader.addPr(merged, makeThreadFor(merged));
    await h.engine.sync({ maxAgentCalls: 0 });

    expect((await h.engine.approve(merged.key)).ok).toBe(false);
    expect(h.writer.calls).toEqual([]);
  });
});

describe('snooze', () => {
  it('snoozes until a time and wakes up after it', async () => {
    const h = await synced();
    await h.engine.markRead(tileId);

    await h.engine.snooze(tileId, { kind: 'until_time', until: '2099-01-01T00:00:00.000Z' });
    expect(await tileState(h)).toBe('snoozed');

    await h.engine.unsnooze(tileId);
    expect(await tileState(h)).toBe('done');
  });
});

describe('feedback', () => {
  it('wrong_topic with a target moves the PR as a user assignment', async () => {
    const h = await synced();
    h.store.topics.create(topic('depot'));

    const result = await h.engine.giveFeedback({ kind: 'wrong_topic', tileId, prKey: pr.key, targetTopicId: 'depot', note: '' });

    expect(result.ok).toBe(true);
    expect(h.store.memberships.get(pr.key)).toMatchObject({ topicId: 'depot', assignedBy: 'user' });
    expect(h.store.feedback.recent(5)[0]?.kind).toBe('wrong_topic');
  });

  it('wrong_topic without a target sends the PR back to Unsorted', async () => {
    const h = await synced();
    h.store.topics.create(topic('depot'));
    h.store.memberships.assign({ prKey: pr.key, topicId: 'depot', assignedBy: 'agent', reason: '', createdAt: at(0) });

    await h.engine.giveFeedback({ kind: 'wrong_topic', tileId, prKey: pr.key, targetTopicId: null, note: 'infra' });

    expect(h.store.memberships.get(pr.key)).toBeNull();
    expect(h.store.feedback.recentForTopic('depot', 5)[0]?.note).toBe('infra');
  });

  it('not_mine clears the unread tile and marks the notification read after the undo window', async () => {
    const h = await synced();
    expect(await tileState(h)).toBe('unread');

    const result = await h.engine.giveFeedback({ kind: 'not_mine', tileId, prKey: null, targetTopicId: null, note: '' });

    expect(result.undoToken).not.toBeNull();
    expect(h.store.userPrStates.get(pr.key)?.handledAt).not.toBeNull();
    expect(await tileState(h)).toBe('done');
    expect(h.writer.calls).toEqual([]);
    h.timers.advance(UNDO_WINDOW_MS);
    await settle();
    expect(h.writer.calls).toEqual(['markThreadRead thread-1']);
  });

  it('not_related drops the member and dissolves a set of two', async () => {
    const { h, other } = await syncedWithPairSet();

    const result = await h.engine.giveFeedback({ kind: 'not_related', tileId: 'set:s1', prKey: other.key, targetTopicId: null, note: '' });

    expect(result.ok).toBe(true);
    expect(h.store.sets.get('s1')?.status).toBe('dissolved');
  });

  it('not_mine on a whole set logs one entry per member so each glance hears about it', async () => {
    const { h, other } = await syncedWithPairSet();

    await h.engine.giveFeedback({ kind: 'not_mine', tileId: 'set:s1', prKey: null, targetTopicId: null, note: 'infra' });

    const logged = h.store.feedback.recentForTopic('depot', 5).map((f) => f.prKey);
    expect(logged.sort()).toEqual([pr.key, other.key].sort());
  });

  it('unmute sets a user override and logs it', async () => {
    const h = await synced();
    const event = h.store.events.listForPr(pr.key)[0]!;
    h.store.events.setOverride(event.id, { loudness: 'muted', reason: 'noise', by: 'agent' });

    await h.engine.unmuteEvent(event.id);

    expect(h.store.events.listForPr(pr.key)[0]?.override).toMatchObject({ by: 'user', loudness: 'loud' });
    expect(h.store.feedback.recent(1)[0]?.kind).toBe('unmute');
  });
});

describe('chat and tailoring', () => {
  it('stores both messages and only keeps tailoring once the user confirms', async () => {
    const h = await synced();
    h.store.topics.create(topic('depot'));
    h.store.memberships.assign({ prKey: pr.key, topicId: 'depot', assignedBy: 'agent', reason: '', createdAt: at(0) });
    h.runner.answer('chat', { reply: 'Got it.', lasting: { text: 'Ignore preview deploys.', scope: 'topic' } });

    const reply = await h.engine.chat(tileId, 'preview deploys are noise here');

    expect(reply.tailoringProposal).toEqual({ topicId: 'depot', text: 'Ignore preview deploys.' });
    expect((await h.engine.getChat(tileId)).map((m) => m.role)).toEqual(['user', 'agent']);
    expect(h.store.topics.get('depot')?.tailoring).toBe('');

    await h.engine.decideTailoring('depot', 'Ignore preview deploys.', true);
    expect(h.store.topics.get('depot')?.tailoring).toBe('Ignore preview deploys.');
    expect(h.store.feedback.recentForTopic('depot', 1)[0]?.kind).toBe('tailoring_kept');
  });
});

describe('topic proposals', () => {
  it('applies an accepted rename once', async () => {
    const h = await synced();
    h.store.topics.create(topic('depot'));
    h.store.proposals.add({
      id: 'p1',
      kind: 'rename',
      topicId: 'depot',
      name: 'Depot runners',
      intoTopicId: null,
      prKeys: [],
      reason: 'clearer',
      status: 'pending',
      createdAt: at(0),
      decidedAt: null,
    });

    expect((await h.engine.decideTopicProposal('p1', true)).ok).toBe(true);
    expect(h.store.topics.get('depot')?.name).toBe('Depot runners');
    expect((await h.engine.decideTopicProposal('p1', true)).ok).toBe(false);
  });
});

describe('comments', () => {
  it('drafts through the agent and sends only on sendComment', async () => {
    const h = await synced();
    h.runner.answer('draft_comment', { body: '@bob can you check the migration?' });

    const draft = await h.engine.draftAsk(pr.key, 'bob', 'check the migration');
    expect(h.writer.calls).toEqual([]);

    await h.engine.sendComment(pr.key, draft.body);
    expect(h.writer.calls).toEqual(['commentOnPr PostHog/posthog#1 @bob can you check the migration?']);
  });
});

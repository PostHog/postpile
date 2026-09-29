// Confirms the engine's own actions actually call through to Telemetry with
// the right shape, not just that the Telemetry class is wired in. One test
// per event is enough here: the props themselves are already covered by the
// zod catalogue in packages/core.
import { at, makeFact, makeFactRef, makeThreadFor } from '@postpile/core/fixtures';
import { describe, expect, it, vi } from 'vitest';
import { makeHarness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { topicWithPrs } from './testing/topics.ts';

const pr = reviewRequestedPr(1);
const tileId = `pr:${pr.key}`;

async function synced() {
  const h = makeHarness();
  h.reader.addPr(pr, makeThreadFor(pr));
  await h.engine.sync({ maxAgentCalls: 0 });
  h.telemetry.events.length = 0; // only care about what happens after the sync itself
  return h;
}

describe('engine telemetry', () => {
  it('fires sync_completed (and first_sync_completed once) on a fresh database', async () => {
    const h = makeHarness();
    h.reader.addPr(pr, makeThreadFor(pr));
    await h.engine.sync({ maxAgentCalls: 0 });

    const names = h.telemetry.events.map((e) => e.event);
    expect(names).toContain('sync_completed');
    expect(names).toContain('first_sync_completed');

    h.telemetry.events.length = 0;
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.telemetry.events.map((e) => e.event)).not.toContain('first_sync_completed');
  });

  it('marks the background sync as trigger auto, a later sync as manual', async () => {
    const h = makeHarness();
    h.reader.addPr(pr, makeThreadFor(pr));
    await h.engine.sync({ maxAgentCalls: 0 });
    h.engine.startAutoSync({ minutes: 1, maxAgentCalls: 0 });
    h.telemetry.events.length = 0;

    h.timers.advance(60 * 1000);

    await vi.waitFor(() => expect(h.telemetry.events.map((e) => e.event)).toContain('sync_completed'));
    expect(h.telemetry.events.find((e) => e.event === 'sync_completed')?.props).toMatchObject({ trigger: 'auto' });
    h.engine.stopAutoSync();
    h.telemetry.events.length = 0;
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.telemetry.events.find((e) => e.event === 'sync_completed')?.props).toMatchObject({ trigger: 'manual' });
  });

  it('fires recheck_proposed on the agent answer and recheck_resolved only on the user accept', async () => {
    const h = makeHarness();
    topicWithPrs(h, 'depot', [pr]);
    await h.engine.sync({ maxAgentCalls: 0 });
    h.store.facts.add(makeFact({ id: 'f1', topicId: 'depot', text: 'alice drives the rollout', refs: [makeFactRef({ prKey: pr.key })] }));
    h.runner.answer('memory_recheck', { outcome: 'drop', text: '', why: 'bob took over.' });
    h.telemetry.events.length = 0;

    await h.engine.recheckMemory({ factId: 'f1', topicId: null, text: 'alice drives the rollout', target: { kind: 'fact', factId: 'f1' } });
    expect(h.telemetry.events).toEqual([
      { event: 'recheck_requested', props: {} },
      { event: 'recheck_proposed', props: { outcome: 'drop' } },
    ]);

    h.telemetry.events.length = 0;
    await h.engine.correctMemory({ kind: 'wrong', factId: 'f1', topicId: null, text: 'alice drives the rollout', fromRecheck: true });
    expect(h.telemetry.events).toEqual([
      { event: 'memory_corrected', props: {} },
      { event: 'recheck_resolved', props: { outcome: 'drop' } },
    ]);
  });

  it('fires no recheck_resolved for a plain "Forget"', async () => {
    const h = makeHarness();
    topicWithPrs(h, 'depot', [pr]);
    h.store.facts.add(makeFact({ id: 'f1', topicId: 'depot', text: 'alice drives the rollout', refs: [makeFactRef({ prKey: pr.key })] }));
    await h.engine.correctMemory({ kind: 'wrong', factId: 'f1', topicId: null, text: 'alice drives the rollout' });
    expect(h.telemetry.events.map((e) => e.event)).toEqual(['memory_corrected']);
  });

  it('fires sync_failed when gh is not usable, instead of running the sync', async () => {
    const h = makeHarness();
    h.commands.missing.add('gh');
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.telemetry.events).toContainEqual({ event: 'sync_failed', props: { error_kind: 'gh_unavailable' } });
  });

  it('fires pr_approved on a successful approve', async () => {
    const h = await synced();
    const result = await h.engine.approve(pr.key);
    expect(result.ok).toBe(true);
    expect(h.telemetry.events).toContainEqual({ event: 'pr_approved', props: { from: 'detail', was_agent_approved: false } });
  });

  it('fires marked_read on markRead, with origin tile', async () => {
    const h = await synced();
    await h.engine.markRead(tileId);
    expect(h.telemetry.events).toContainEqual({ event: 'marked_read', props: { count: 1, origin: 'tile' } });
  });

  it('fires snoozed with the condition name for an event-based snooze', async () => {
    const h = await synced();
    await h.engine.snooze(tileId, { kind: 'ci_green' });
    expect(h.telemetry.events).toContainEqual({ event: 'snoozed', props: { duration_bucket: 'ci_green' } });
  });

  it('fires chat_message_sent on chat', async () => {
    const h = await synced();
    h.runner.answer('chat', { reply: 'Got it.' });
    await h.engine.chat(tileId, 'hello');
    expect(h.telemetry.events.map((e) => e.event)).toContain('chat_message_sent');
  });

  it('fires wrong_topic_marked on a successful "wrong topic", never for not_mine', async () => {
    const h = await synced();
    await h.engine.giveFeedback({ kind: 'wrong_topic', tileId, prKey: pr.key, targetTopicId: null, note: '' });
    await h.engine.giveFeedback({ kind: 'not_mine', tileId, prKey: pr.key, targetTopicId: null, note: '' });

    const names = h.telemetry.events.map((e) => e.event);
    expect(names).toEqual(['wrong_topic_marked']);
  });

  it('fires not_related_marked when a PR is dropped from a set tile', async () => {
    const h = await synced();
    const other = reviewRequestedPr(2);
    h.store.prs.upsert(other, at(0));
    h.store.topics.create({
      id: 'depot',
      name: 'depot',
      summary: '',
      summaryInputHash: null,
      area: null,
      tailoring: '',
      driver: null,
      userRole: 'reviewer',
      status: 'active',
      createdAt: at(0),
      updatedAt: at(0),
    });
    for (const key of [pr.key, other.key]) {
      h.store.memberships.assign({ prKey: key, topicId: 'depot', assignedBy: 'agent', reason: '', createdAt: at(0) });
    }
    h.store.sets.save({
      id: 's1',
      topicId: 'depot',
      title: 'Pair',
      take: '',
      members: [
        { prKey: pr.key, reason: 'a' },
        { prKey: other.key, reason: 'b' },
      ],
      removedKeys: [],
      status: 'active',
      inputHash: 'h',
      createdAt: at(0),
      updatedAt: at(0),
    });
    h.telemetry.events.length = 0;

    const result = await h.engine.giveFeedback({ kind: 'not_related', tileId: 'set:s1', prKey: pr.key, targetTopicId: null, note: '' });
    expect(result.ok).toBe(true);
    expect(h.telemetry.events.map((e) => e.event)).toEqual(['not_related_marked']);
  });
});

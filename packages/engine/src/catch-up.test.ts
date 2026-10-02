import type { GlanceGap, Pr, PrKey } from '@postpile/core';
import { makeComment, makeThreadFor, viewer } from '@postpile/core/fixtures';
import { describe, expect, it, vi } from 'vitest';
import { glanceGapKey } from './digest/glance-batches.ts';
import { makeHarness, NOW, type Harness, type HarnessOptions } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { topicWithPrs } from './testing/topics.ts';

// NOW is 2026-09-02T12:00Z; events a few minutes before it are fresh.
const FRESH = '2026-09-02T11:55:00.000Z';
// Thread activity after the sync's fetch time (NOW), so the poll refetches the PR.
const LATER = '2026-09-02T12:01:00.000Z';

/** A topic with one PR, synced with the agent: dossier v1 and a glance. */
async function syncedTopic(options: HarnessOptions = {}): Promise<{ h: Harness; pr: Pr }> {
  const h = makeHarness({ catchUpCallsPerDay: 300, ...options });
  const pr = reviewRequestedPr(1);
  topicWithPrs(h, 'depot', [pr]);
  await h.engine.sync({ maxAgentCalls: 50 });
  return { h, pr };
}

/** A fresh question to the viewer on GitHub, which the next poll fetches. */
function askViewer(h: Harness, pr: Pr, id: string, etag: string): void {
  const next = {
    ...pr,
    updatedAt: LATER,
    comments: [makeComment({ id, author: 'bob', body: `@${viewer.login} can you check the cache key?`, createdAt: FRESH })],
  };
  h.reader.addPr(next, makeThreadFor(next, { updatedAt: LATER }));
  h.reader.etag = etag;
  h.runner.answer('ping_decision', { decisions: [] });
}

function catchUpRunIds(h: Harness): string[] {
  const rows = h.store.db.prepare("SELECT DISTINCT run_id FROM agent_call WHERE run_id LIKE 'catchup:%'").all() as { run_id: string }[];
  return rows.map((row) => row.run_id);
}

async function glanceState(h: Harness, key: PrKey): Promise<string | undefined> {
  return (await h.engine.getPr(key))?.glanceState;
}

describe('glance catch-up after a poll', () => {
  it("updates the topic's dossier and glance right after the poll brings a loud event", async () => {
    const { h, pr } = await syncedTopic();
    expect(h.store.dossiers.latest('depot')?.version).toBe(1);
    askViewer(h, pr, 'c1', 'etag-2');

    await h.engine.pollOnce();

    await vi.waitFor(() => expect(h.store.dossiers.latest('depot')?.version).toBe(2));
    await vi.waitFor(async () => expect(await glanceState(h, pr.key)).toBe('ready'));
    expect(h.store.glances.get(pr.key)?.dossierVersion).toBe(2);
    expect((await h.engine.getPr(pr.key))?.glanceStale).toBe(false);
    // Its calls land in their own run, not in the poll's.
    expect(catchUpRunIds(h)).toEqual([expect.stringMatching(/^catchup:depot:/)]);
    expect((await h.engine.livePollStatus()).catchUpChanges).toBeGreaterThan(0);
    await vi.waitFor(() => expect(h.telemetry.events.map((e) => e.event)).toContain('catch_up_ran'));
    const ran = h.telemetry.events.find((e) => e.event === 'catch_up_ran');
    expect(ran?.props).toMatchObject({ topics: 1, ok: true, agent_calls: expect.any(Number) });
    expect((ran?.props as { agent_calls: number } | undefined)?.agent_calls).toBeGreaterThan(0);
  });

  it('writes the first glance of a PR new to the app in its new topic', async () => {
    const { h } = await syncedTopic();
    const fresh = reviewRequestedPr(3, { updatedAt: LATER });
    h.reader.addPr(fresh, makeThreadFor(fresh, { updatedAt: LATER }));
    h.reader.etag = 'etag-2';
    h.runner.answer('topic_assignment', { assignments: [{ prKey: fresh.key, kind: 'new', name: 'Runners', reason: 'runner sizes' }] });
    h.runner.answer('ping_decision', { decisions: [] });

    await h.engine.pollOnce();

    await vi.waitFor(() => expect(h.store.glances.get(fresh.key)).not.toBeNull());
    const topicId = h.store.memberships.get(fresh.key)?.topicId;
    expect(h.store.dossiers.latest(topicId!)?.version).toBe(1);
    expect(await glanceState(h, fresh.key)).toBe('ready');
  });

  it('does nothing with catch-up off (cap 0)', async () => {
    const { h, pr } = await syncedTopic({ catchUpCallsPerDay: 0 });
    askViewer(h, pr, 'c1', 'etag-2');

    await h.engine.pollOnce();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(h.store.dossiers.latest('depot')?.version).toBe(1);
    expect(catchUpRunIds(h)).toEqual([]);
  });

  it('never overlaps a full sync: the sync waits for a running run, requests during the sync are skipped', async () => {
    const { h, pr } = await syncedTopic();
    askViewer(h, pr, 'c1', 'etag-2');
    const release = h.agent.holdDossier('depot');

    await h.engine.pollOnce();
    // The catch-up's dossier call is out (and held); the sync made the first one.
    await vi.waitFor(() => expect(h.agent.dossierInputs).toHaveLength(2));
    const dossierCalls = h.agent.dossierInputs.length;

    const syncing = h.engine.sync({ maxAgentCalls: 50 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The sync has not started: no progress, and no dossier call of its own.
    expect(await h.engine.syncProgress()).toBeNull();
    expect(h.agent.dossierInputs.length).toBe(dossierCalls);
    expect((await h.engine.livePollStatus()).syncRunning).toBe(true);
    expect((await h.engine.retryGlance(pr.key)).message).toBe('A sync is running; it retries this glance.');

    release();
    await syncing;
    expect((await h.engine.livePollStatus()).syncRunning).toBe(false);
    expect(h.store.dossiers.latest('depot')?.version).toBe(2);
  });

  it('stops at the daily cap and says so on the PR', async () => {
    // One call a day: the dossier update gets it, the glance does not.
    const { h, pr } = await syncedTopic({ catchUpCallsPerDay: 1 });
    askViewer(h, pr, 'c1', 'etag-2');

    await h.engine.pollOnce();

    await vi.waitFor(() => expect(h.store.meta.get(glanceGapKey(pr.key))).not.toBeNull());
    expect(h.store.dossiers.latest('depot')?.version).toBe(2);
    const gap = JSON.parse(h.store.meta.get(glanceGapKey(pr.key))!) as GlanceGap;
    expect(gap.reason).toBe('daily_cap');
    // The old glance stays (stale) once the run is over; the gap only shows while there is none.
    await vi.waitFor(async () => expect(await glanceState(h, pr.key)).toBe('ready'));
    expect((await h.engine.getPr(pr.key))?.glanceStale).toBe(true);
    expect((await h.engine.retryGlance(pr.key)).ok).toBe(false);
  });
});

describe('Engine.retryGlance', () => {
  it('turns a failed glance into a new one through a catch-up run', async () => {
    const h = makeHarness({ catchUpCallsPerDay: 300 });
    const pr = reviewRequestedPr(1);
    topicWithPrs(h, 'depot', [pr]);
    await h.engine.sync({ maxAgentCalls: 1 });
    const failed: GlanceGap = { reason: 'failed', detail: 'left out of the answer', at: NOW.toISOString() };
    h.store.meta.set(glanceGapKey(pr.key), JSON.stringify(failed));
    expect(await glanceState(h, pr.key)).toBe('failed');

    const result = await h.engine.retryGlance(pr.key);

    expect(result).toMatchObject({ ok: true, message: 'Writing the glance…' });
    await vi.waitFor(async () => expect(await glanceState(h, pr.key)).toBe('ready'));
    expect(h.store.meta.get(glanceGapKey(pr.key))).toBeNull();
  });

  it('says agent_off and refuses while claude is off', async () => {
    const h = makeHarness({ catchUpCallsPerDay: 300 });
    const pr = reviewRequestedPr(1);
    topicWithPrs(h, 'depot', [pr]);
    await h.engine.sync({ maxAgentCalls: 0 });
    h.commands.missing.add('claude');
    await h.engine.checkTools();

    expect(await glanceState(h, pr.key)).toBe('agent_off');
    expect((await h.engine.retryGlance(pr.key)).ok).toBe(false);
  });
});

/** The stored glance reads as made for an older input (new commits, say): stale, as the read model sees it. */
function makeGlanceStale(h: Harness, key: PrKey): void {
  const glance = h.store.glances.get(key);
  h.store.glances.put({ ...glance!, inputHash: 'an-older-input' });
}

describe('Engine.refreshGlanceOnLook', () => {
  it('rewrites a stale glance from the dossier as it is, shown as writing meanwhile', async () => {
    const { h, pr } = await syncedTopic();
    makeGlanceStale(h, pr.key);
    expect((await h.engine.getPr(pr.key))?.glanceRefreshBlock).toBeNull();
    const dossierCalls = h.agent.dossierInputs.length;
    const glanceCalls = h.agent.glanceInputs.length;

    expect(await h.engine.refreshGlanceOnLook(pr.key)).toEqual({ outcome: 'started' });
    expect(await glanceState(h, pr.key)).toBe('writing');
    // A glance-only run rewrites no memory: the dossier and facts do not read as updating.
    expect((await h.engine.getPr(pr.key))?.memoryUpdating).toBe(false);
    expect((await h.engine.getTopic('depot'))?.memoryUpdating).toBe(false);

    await vi.waitFor(async () => expect((await h.engine.getPr(pr.key))?.glanceStale).toBe(false));
    expect(await glanceState(h, pr.key)).toBe('ready');
    expect(h.agent.glanceInputs.length).toBe(glanceCalls + 1);
    expect(h.agent.glanceInputs.at(-1)?.items.map((item) => item.pr.key)).toEqual([pr.key]);
    // No dossier update: the dossier is used as it is.
    expect(h.agent.dossierInputs.length).toBe(dossierCalls);
    expect(h.store.dossiers.latest('depot')?.version).toBe(1);
    expect(catchUpRunIds(h)).toEqual([expect.stringMatching(/^catchup:depot:glance:/)]);
  });

  it('makes no call for an up-to-date glance', async () => {
    const { h, pr } = await syncedTopic();
    const glanceCalls = h.agent.glanceInputs.length;

    expect(await h.engine.refreshGlanceOnLook(pr.key)).toEqual({ outcome: 'current' });

    await h.engine.livePollStatus();
    expect(h.agent.glanceInputs.length).toBe(glanceCalls);
    expect(catchUpRunIds(h)).toEqual([]);
  });

  it('makes no call over the daily cap, and says the next sync writes it', async () => {
    // One catch-up call a day: the first refresh takes it.
    const { h, pr } = await syncedTopic({ catchUpCallsPerDay: 1 });
    makeGlanceStale(h, pr.key);
    await h.engine.refreshGlanceOnLook(pr.key);
    await vi.waitFor(async () => expect((await h.engine.getPr(pr.key))?.glanceStale).toBe(false));
    makeGlanceStale(h, pr.key);
    const glanceCalls = h.agent.glanceInputs.length;

    expect(await h.engine.refreshGlanceOnLook(pr.key)).toEqual({ outcome: 'blocked' });

    expect(h.agent.glanceInputs.length).toBe(glanceCalls);
    const detail = await h.engine.getPr(pr.key);
    expect(detail?.glanceRefreshBlock).toBe('daily_cap');
    expect(detail?.glanceState).toBe('ready');
  });

  it('makes no call with catch-up off (cap 0)', async () => {
    const { h, pr } = await syncedTopic({ catchUpCallsPerDay: 0 });
    makeGlanceStale(h, pr.key);

    expect(await h.engine.refreshGlanceOnLook(pr.key)).toEqual({ outcome: 'blocked' });
    expect((await h.engine.getPr(pr.key))?.glanceRefreshBlock).toBe('catch_up_off');
    expect(catchUpRunIds(h)).toEqual([]);
  });

  it('queues the PR behind a topic run already going, which read it before it changed', async () => {
    const { h, pr } = await syncedTopic();
    askViewer(h, pr, 'c1', 'etag-2');
    const release = h.agent.holdDossier('depot');
    await h.engine.pollOnce();
    // The topic's catch-up runs (its dossier call is held) and has read its glance inputs already.
    await vi.waitFor(() => expect(h.agent.dossierInputs).toHaveLength(2));
    expect((await h.engine.getTopic('depot'))?.memoryUpdating).toBe(true);
    expect((await h.engine.getPr(pr.key))?.memoryUpdating).toBe(true);
    // An author push lands meanwhile: the run's snapshot is behind it.
    const current = h.store.prs.get(pr.key)!;
    h.store.prs.upsert({ ...current, headOid: 'pushed-after-the-run-started' }, NOW.toISOString());
    expect(await h.engine.refreshGlanceOnLook(pr.key)).toEqual({ outcome: 'queued' });

    release();
    // The topic run stores a glance from its old snapshot; the glance follow-up rewrites it.
    await vi.waitFor(() => expect(catchUpRunIds(h)).toEqual([expect.stringMatching(/^catchup:depot:\d/), expect.stringMatching(/^catchup:depot:glance:/)]));
    await vi.waitFor(async () => expect((await h.engine.getPr(pr.key))?.glanceStale).toBe(false));
    expect(h.agent.glanceInputs.at(-1)?.items[0]?.pr.headOid).toBe('pushed-after-the-run-started');
  });

  it('asks again once a consolidation that was running ends', async () => {
    const { h, pr } = await syncedTopic();
    makeGlanceStale(h, pr.key);

    const consolidating = h.engine.consolidate();
    expect(await h.engine.refreshGlanceOnLook(pr.key)).toEqual({ outcome: 'deferred' });
    await consolidating;

    await vi.waitFor(async () => expect((await h.engine.getPr(pr.key))?.glanceStale).toBe(false));
    expect(catchUpRunIds(h)).toEqual([expect.stringMatching(/^catchup:depot:glance:/)]);
  });
});

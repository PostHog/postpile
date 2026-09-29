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

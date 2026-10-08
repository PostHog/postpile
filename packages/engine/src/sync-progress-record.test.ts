import { emptyAgentCallStats, SYNC_PROGRESS_HEARTBEAT_MS, type SyncProgress } from '@postpile/core';
import { Store } from '@postpile/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSyncProgress, SyncProgressRecorder } from './sync-progress-record.ts';
import { makePr, makeThreadFor } from '@postpile/core/fixtures';
import { makeHarness } from './testing/fakes.ts';

describe('SyncProgressRecorder', () => {
  let store: Store;
  let nowMs: number;
  let progress: SyncProgress | null;
  let recorder: SyncProgressRecorder;

  beforeEach(() => {
    store = Store.open(':memory:');
    nowMs = Date.parse('2026-09-01T10:00:00Z');
    progress = { startedAt: '2026-09-01T10:00:00Z', running: ['fetch'], agentCallsDone: 0, agentCallsPlanned: 0, fromGitHub: null, prsRead: null, agentCallStats: emptyAgentCallStats() };
    recorder = new SyncProgressRecorder(store, () => new Date(nowMs), () => progress, () => {});
  });

  afterEach(() => {
    recorder.stop();
    store.close();
  });

  it('writes what moved, skips what did not until the heartbeat is due, and removes it at the end', () => {
    recorder.save();
    expect(loadSyncProgress(store)).toEqual({
      startedAt: '2026-09-01T10:00:00Z',
      running: ['fetch'],
      agentCallsDone: 0,
      agentCallsPlanned: 0,
      fromGitHub: null,
      prsRead: null,
      savedAt: '2026-09-01T10:00:00.000Z',
    });

    nowMs += 5_000;
    recorder.save();
    expect(loadSyncProgress(store)?.savedAt).toBe('2026-09-01T10:00:00.000Z');

    progress = { ...progress!, running: ['topics'], fromGitHub: { prsFetched: 40, newEvents: 3 } };
    recorder.save();
    expect(loadSyncProgress(store)).toMatchObject({ running: ['topics'], fromGitHub: { prsFetched: 40, newEvents: 3 }, savedAt: '2026-09-01T10:00:05.000Z' });

    nowMs += SYNC_PROGRESS_HEARTBEAT_MS;
    recorder.save();
    expect(loadSyncProgress(store)?.savedAt).toBe('2026-09-01T10:01:05.000Z');

    recorder.stop();
    expect(loadSyncProgress(store)).toBeNull();
  });
});

describe('a full sync and its stored progress', () => {
  it('stores the progress while it runs and removes it once the report is stored', async () => {
    const h = makeHarness();
    let seenWhileRunning: unknown = null;
    const viewer = h.reader.viewer.bind(h.reader);
    h.reader.viewer = async () => {
      seenWhileRunning = loadSyncProgress(h.store);
      return viewer();
    };
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(seenWhileRunning).toMatchObject({ running: ['fetch'], fromGitHub: null });
    expect(loadSyncProgress(h.store)).toBeNull();
    expect(await h.engine.lastSyncReport()).not.toBeNull();
  });

  it('counts the PRs the fetch read against the ones it planned, while it reads them', async () => {
    const h = makeHarness();
    for (const number of [1, 2, 3]) {
      const pr = makePr({ number, reviewerUsers: ['viewer'] });
      h.reader.addPr(pr, makeThreadFor(pr));
    }
    const counts: unknown[] = [];
    const fetchPrs = h.reader.fetchPrs.bind(h.reader);
    h.reader.fetchPrs = async (refs) => {
      counts.push((await h.engine.syncProgress())?.prsRead);
      return fetchPrs(refs);
    };
    await h.engine.sync({ maxAgentCalls: 0 });
    // Planned once the fetch picked its PRs, nothing read yet while the batch is out.
    expect(counts[0]).toEqual({ read: 0, planned: 3 });
    expect(loadSyncProgress(h.store)).toBeNull();
  });
});

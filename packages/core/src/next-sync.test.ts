import { describe, expect, it } from 'vitest';
import { emptyAgentCallStats, recordAgentCall } from './agent-calls.ts';
import { agentWorkLeftOver, ownBulkReadAt, syncLeftBacklog, type SyncEnd } from './next-sync.ts';

/** 100 dossier calls made, 91 glances skipped by the cap: the owner's sync after a week away. */
function cappedStats() {
  const stats = emptyAgentCallStats();
  recordAgentCall(stats, { kind: 'dossier_update', outcome: 'ok' });
  recordAgentCall(stats, { kind: 'glance_batch', outcome: 'skipped_by_budget' });
  return stats;
}

function end(overrides: Partial<SyncEnd> = {}): SyncEnd {
  return { heldForCatchUp: false, prsSkipped: 0, boardFull: false, agentCallStats: emptyAgentCallStats(), ...overrides };
}

describe('agentWorkLeftOver', () => {
  it('is true when the cap skipped work and some call came back', () => {
    expect(agentWorkLeftOver(cappedStats())).toBe(true);
  });

  it('is false with nothing skipped', () => {
    const stats = emptyAgentCallStats();
    recordAgentCall(stats, { kind: 'dossier_update', outcome: 'ok' });
    expect(agentWorkLeftOver(stats)).toBe(false);
  });

  it('is false when no call got anywhere: a cap of 0, or every call failed', () => {
    const capZero = emptyAgentCallStats();
    recordAgentCall(capZero, { kind: 'glance_batch', outcome: 'skipped_by_budget' });
    const allFailed = emptyAgentCallStats();
    recordAgentCall(allFailed, { kind: 'dossier_update', outcome: 'failed' });
    recordAgentCall(allFailed, { kind: 'glance_batch', outcome: 'skipped_by_budget' });
    expect([agentWorkLeftOver(capZero), agentWorkLeftOver(allFailed)]).toEqual([false, false]);
  });
});

describe('syncLeftBacklog', () => {
  it('counts PRs over the PR cap while the board has room', () => {
    expect(syncLeftBacklog(end({ prsSkipped: 3 }))).toBe(true);
    expect(syncLeftBacklog(end({ prsSkipped: 3, boardFull: true }))).toBe(false);
  });

  it('counts agent work the call cap skipped, full board or not', () => {
    expect(syncLeftBacklog(end({ agentCallStats: cappedStats() }))).toBe(true);
    expect(syncLeftBacklog(end({ prsSkipped: 3, boardFull: true, agentCallStats: cappedStats() }))).toBe(true);
  });

  it('never counts a sync held for the catch-up dialog', () => {
    expect(syncLeftBacklog(end({ heldForCatchUp: true, prsSkipped: 3, agentCallStats: cappedStats() }))).toBe(false);
  });

  it('is false for a sync that got through everything', () => {
    expect(syncLeftBacklog(end())).toBe(false);
  });
});

describe('ownBulkReadAt', () => {
  const thread = { repo: 'acme/app', updatedAt: '2026-10-20T10:00:00.000Z' };

  it('covers a thread in the call\'s scope with no newer activity', () => {
    expect(ownBulkReadAt([{ repo: 'acme/app', lastReadAt: '2026-10-26T09:00:00.000Z' }], thread)).toBe('2026-10-26T09:00:00.000Z');
    expect(ownBulkReadAt([{ repo: null, lastReadAt: '2026-10-21T00:00:00.000Z' }], thread)).toBe('2026-10-21T00:00:00.000Z');
  });

  it('leaves other repos and threads with newer activity alone', () => {
    expect(ownBulkReadAt([{ repo: 'acme/web', lastReadAt: '2026-10-26T09:00:00.000Z' }], thread)).toBeNull();
    expect(ownBulkReadAt([{ repo: null, lastReadAt: '2026-10-12T00:00:00.000Z' }], thread)).toBeNull();
    expect(ownBulkReadAt([], thread)).toBeNull();
  });

  it('takes the latest last_read_at when several calls cover it', () => {
    const reads = [
      { repo: null, lastReadAt: '2026-10-21T00:00:00.000Z' },
      { repo: 'acme/app', lastReadAt: '2026-10-26T09:00:00.000Z' },
    ];
    expect(ownBulkReadAt(reads, thread)).toBe('2026-10-26T09:00:00.000Z');
  });
});

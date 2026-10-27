import { describe, expect, it } from 'vitest';
import type { AgentCallCount, AgentCallStats } from '@postpile/core';
import { callStatsDetail, callStatsLabel, callStatsWords, backlogSyncMinutes, capNote } from './agent-stats.ts';

function count(overrides: Partial<AgentCallCount>): AgentCallCount {
  return { calls: 1, failed: 0, retries: 0, skippedUnchanged: 0, skippedByBudget: 0, durationMs: 0, costUsd: null, ...overrides };
}

describe('callStatsLabel', () => {
  it('counts calls and never shows a cost', () => {
    const stats: AgentCallStats = { total: 3, byKind: { dossier_update: count({ calls: 2, costUsd: 0.1 }), glance_batch: count({ costUsd: 0.04 }) } };
    expect(callStatsLabel(stats)).toBe('3 agent calls');
  });

  it('says call for one', () => {
    expect(callStatsLabel({ total: 1, byKind: { chat: count({}) } })).toBe('1 agent call');
    expect(callStatsWords({ total: 1, byKind: { chat: count({}) } })).toBe('agent call');
  });
});

describe('callStatsDetail', () => {
  it('lists each kind with failures and budget skips', () => {
    const stats: AgentCallStats = { total: 2, byKind: { dossier_update: count({ calls: 2, failed: 1, skippedByBudget: 3 }) } };
    expect(callStatsDetail(stats)).toBe('dossier_update: 2 calls, 1 failed, 3 skipped by the cap');
  });
});

describe('capNote', () => {
  const now = new Date('2026-10-27T10:00:00.000Z');
  const stats: AgentCallStats = { total: 2, byKind: { dossier_update: count({ skippedByBudget: 3 }), glance_batch: count({ skippedByBudget: 4 }) } };
  const backlogSoon = { at: '2026-10-27T10:02:00.000Z', isBacklog: true };
  const fullInterval = { at: '2026-10-27T11:00:00.000Z', isBacklog: false };

  it('says the app picks up the rest itself while a backlog sync is due', () => {
    expect(capNote(stats, 60, backlogSoon, now)).toBe('stopped at call cap: 7 left, next sync in 2 min');
    expect(capNote(stats, 60, { at: '2026-10-27T10:00:10.000Z', isBacklog: true }, now)).toBe('stopped at call cap: 7 left, next sync in 1 min');
  });

  it('keeps the old wording when no backlog sync is coming', () => {
    expect(capNote(stats, 0, null, now)).toBe('stopped at call cap: 7 left for the next sync');
    expect(capNote(stats, 0, { at: null, isBacklog: false }, now)).toBe('stopped at call cap: 7 left for the next sync');
    expect(capNote(stats, 60, fullInterval, now)).toBe('stopped at call cap: 7 left for the hourly sync');
    expect(capNote(stats, 15, fullInterval, now)).toBe('stopped at call cap: 7 left for the auto sync (every 15 min)');
  });

  it('says nothing when the cap was not reached', () => {
    expect(capNote({ total: 1, byKind: { chat: count({}) } }, 60, backlogSoon, now)).toBeNull();
  });
});

describe('backlogSyncMinutes', () => {
  const now = new Date('2026-10-27T10:00:00.000Z');

  it('counts only a due backlog sync', () => {
    expect(backlogSyncMinutes({ at: '2026-10-27T10:02:00.000Z', isBacklog: true }, now)).toBe(2);
    expect(backlogSyncMinutes({ at: '2026-10-27T10:02:00.000Z', isBacklog: false }, now)).toBeNull();
    expect(backlogSyncMinutes({ at: null, isBacklog: true }, now)).toBeNull();
    expect(backlogSyncMinutes(null, now)).toBeNull();
  });
});

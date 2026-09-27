import { describe, expect, it } from 'vitest';
import type { AgentCallCount, AgentCallStats } from '@code-manager/core';
import { callStatsDetail, callStatsLabel, capNote } from './agent-stats.ts';

function count(overrides: Partial<AgentCallCount>): AgentCallCount {
  return { calls: 1, failed: 0, retries: 0, skippedUnchanged: 0, skippedByBudget: 0, durationMs: 0, costUsd: null, ...overrides };
}

describe('callStatsLabel', () => {
  it('adds up calls and cost', () => {
    const stats: AgentCallStats = { total: 3, byKind: { dossier_update: count({ calls: 2, costUsd: 0.1 }), glance_batch: count({ costUsd: 0.04 }) } };
    expect(callStatsLabel(stats)).toBe('3 agent calls · $0.14');
  });

  it('leaves the cost out when none was reported', () => {
    expect(callStatsLabel({ total: 1, byKind: { chat: count({}) } })).toBe('1 agent call');
  });
});

describe('callStatsDetail', () => {
  it('lists each kind with failures and budget skips', () => {
    const stats: AgentCallStats = { total: 2, byKind: { dossier_update: count({ calls: 2, failed: 1, skippedByBudget: 3 }) } };
    expect(callStatsDetail(stats)).toBe('dossier_update: 2 calls, 1 failed, 3 skipped by the cap');
  });
});

describe('capNote', () => {
  it('says how much work waits for the next sync', () => {
    const stats: AgentCallStats = { total: 2, byKind: { dossier_update: count({ skippedByBudget: 3 }), glance_batch: count({ skippedByBudget: 4 }) } };
    expect(capNote(stats)).toBe('stopped at call cap: 7 left for next sync');
    expect(capNote({ total: 1, byKind: { chat: count({}) } })).toBeNull();
  });
});

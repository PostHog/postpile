import type { ConsolidateOptions, ConsolidationReport } from '@postpile/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONSOLIDATION_CHECK_MS, ConsolidationSchedule } from './consolidation-schedule.ts';

function report(overrides: Partial<ConsolidationReport> = {}): ConsolidationReport {
  return {
    startedAt: '2026-09-29T08:00:00.000Z',
    finishedAt: '2026-09-29T08:01:00.000Z',
    skipped: null,
    topicProposalsFiled: 1,
    ruleProposalsFiled: 0,
    factsMerged: 2,
    topicsRetired: 0,
    topicsSplit: 0,
    agentCallStats: { total: 1, byKind: {} },
    errors: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ConsolidationSchedule', () => {
  it('asks every 30 minutes with onlyIfDue and the sync cap, and logs only real runs', async () => {
    vi.useFakeTimers();
    const calls: ConsolidateOptions[] = [];
    const answers = [report({ skipped: 'not_due' }), report()];
    const lines: string[] = [];
    const schedule = new ConsolidationSchedule(
      async (options) => {
        calls.push(options);
        return answers.shift()!;
      },
      30,
      (line) => lines.push(line),
    );

    schedule.start();
    await vi.advanceTimersByTimeAsync(CONSOLIDATION_CHECK_MS);
    expect(lines).toEqual([]);
    await vi.advanceTimersByTimeAsync(CONSOLIDATION_CHECK_MS);
    schedule.stop();
    await vi.advanceTimersByTimeAsync(CONSOLIDATION_CHECK_MS);

    expect(calls).toEqual([
      { onlyIfDue: true, maxAgentCalls: 30 },
      { onlyIfDue: true, maxAgentCalls: 30 },
    ]);
    expect(lines).toEqual(['consolidation: 1 topic and 0 rule proposals, 2 facts merged, 0 topics retired, 0 small splits applied, 1 agent calls']);
  });

  it('logs a failure instead of throwing', async () => {
    const lines: string[] = [];
    const schedule = new ConsolidationSchedule(() => Promise.reject(new Error('boom')), 30, (line) => lines.push(line));

    await schedule.runIfDue();

    expect(lines).toEqual(['consolidation failed: boom']);
  });
});

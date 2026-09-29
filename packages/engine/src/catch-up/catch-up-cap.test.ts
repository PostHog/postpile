import { emptyAgentCallStats } from '@postpile/core';
import { describe, expect, it } from 'vitest';
import { AgentBudget } from '../budget.ts';
import { catchUpCapFromEnv } from '../create.ts';
import { CatchUpCap } from './catch-up-cap.ts';

describe('CatchUpCap', () => {
  it('allows perDay calls in a rolling 24 hours', () => {
    let now = new Date('2026-09-29T08:00:00Z');
    const cap = new CatchUpCap(2, () => now);

    expect([cap.take(), cap.take(), cap.take()]).toEqual([true, true, false]);
    expect(cap.remaining()).toBe(0);

    now = new Date('2026-09-30T08:00:01Z');
    expect(cap.remaining()).toBe(2);
    expect(cap.take()).toBe(true);
  });
});

describe('AgentBudget with a daily allowance', () => {
  it('asks the daily cap only after the run cap, and says when the daily cap stopped it', () => {
    const cap = new CatchUpCap(1, () => new Date('2026-09-29T08:00:00Z'));
    const stats = emptyAgentCallStats();
    const budget = new AgentBudget(5, stats, cap);

    expect(budget.take('dossier_update')).toBe(true);
    expect(budget.stoppedByDailyCap()).toBe(false);
    expect(budget.take('glance_batch')).toBe(false);
    expect(budget.stoppedByDailyCap()).toBe(true);
    expect(stats.byKind.glance_batch?.skippedByBudget).toBe(1);
  });

  it('does not use up a daily call when the run cap refuses', () => {
    const cap = new CatchUpCap(10, () => new Date('2026-09-29T08:00:00Z'));
    const budget = new AgentBudget(1, emptyAgentCallStats(), cap);

    budget.take('dossier_update');
    budget.take('glance_batch');

    expect(cap.remaining()).toBe(9);
    expect(budget.stoppedByDailyCap()).toBe(false);
  });
});

describe('catchUpCapFromEnv', () => {
  it('reads POSTPILE_CATCHUP_CAP, and stays off when a dev session allows no agent calls', () => {
    expect(catchUpCapFromEnv(undefined, undefined)).toBe(300);
    expect(catchUpCapFromEnv('40', undefined)).toBe(40);
    expect(catchUpCapFromEnv('0', undefined)).toBe(0);
    expect(catchUpCapFromEnv('lots', '150')).toBe(300);
    expect(catchUpCapFromEnv(undefined, '0')).toBe(0);
    expect(catchUpCapFromEnv('20', '0')).toBe(20);
  });
});

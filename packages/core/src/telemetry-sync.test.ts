import { describe, expect, it } from 'vitest';
import { emptyAgentCallStats, recordAgentCall } from './agent-calls.ts';
import { agentCallSummary, rateLimitSourceFromErrors } from './telemetry-sync.ts';

describe('agentCallSummary', () => {
  it('sums failures and cost across kinds, and flags a budget stop', () => {
    const stats = emptyAgentCallStats();
    recordAgentCall(stats, { kind: 'glance_batch', outcome: 'ok', costUsd: 0.02 });
    recordAgentCall(stats, { kind: 'glance_batch', outcome: 'failed', costUsd: 0.01 });
    recordAgentCall(stats, { kind: 'dossier_update', outcome: 'skipped_by_budget' });

    const summary = agentCallSummary(stats);
    expect(summary.failed).toBe(1);
    expect(summary.costUsd).toBeCloseTo(0.03);
    expect(summary.stoppedAtCap).toBe(true);
  });

  it('is all zero/false for an empty run', () => {
    expect(agentCallSummary(emptyAgentCallStats())).toEqual({ failed: 0, costUsd: 0, stoppedAtCap: false });
  });
});

describe('rateLimitSourceFromErrors', () => {
  it('is null without a rate-limit mention', () => {
    expect(rateLimitSourceFromErrors(['sync: some other failure'])).toBeNull();
  });

  it('reads rest from the "failed with <status>" shape', () => {
    expect(rateLimitSourceFromErrors(['GitHub GET team members failed with 403: rate limit exceeded'])).toBe('rest');
  });

  it('reads graphql from an HTTP-level answer to the GraphQL endpoint', () => {
    expect(rateLimitSourceFromErrors(['GitHub POST graphql failed with 403: API rate limit exceeded'])).toBe('graphql');
  });

  it('reads graphql from the "failed: <message>" shape', () => {
    expect(rateLimitSourceFromErrors(['GitHub PR batch query failed: API rate limit exceeded for installation'])).toBe('graphql');
  });
});

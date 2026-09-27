import { describe, expect, it } from 'vitest';
import { emptyAgentCallStats, recordAgentCall } from './agent-calls.ts';

describe('recordAgentCall', () => {
  it('counts calls, failures and retries per kind, and skips without calling them calls', () => {
    const stats = emptyAgentCallStats();
    recordAgentCall(stats, { kind: 'glance_batch', outcome: 'ok', durationMs: 1200, costUsd: 0.01 });
    recordAgentCall(stats, { kind: 'glance_batch', outcome: 'failed', attempt: 2, durationMs: 800, costUsd: null });
    recordAgentCall(stats, { kind: 'dossier_update', outcome: 'skipped_unchanged' });
    recordAgentCall(stats, { kind: 'dossier_update', outcome: 'skipped_by_budget' });

    expect(stats.total).toBe(2);
    expect(stats.byKind.glance_batch).toEqual({
      calls: 2,
      failed: 1,
      retries: 1,
      skippedUnchanged: 0,
      skippedByBudget: 0,
      durationMs: 2000,
      costUsd: 0.01,
    });
    expect(stats.byKind.dossier_update).toMatchObject({ calls: 0, skippedUnchanged: 1, skippedByBudget: 1, costUsd: null });
  });
});

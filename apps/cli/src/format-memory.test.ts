import { describe, expect, it } from 'vitest';
import { emptyAgentCallStats, recordAgentCall } from '@postpile/core';
import { formatCallStats } from './format-memory.ts';

describe('memory formatting', () => {
  it('prints call stats per kind with skips, retries and cost', () => {
    const stats = emptyAgentCallStats();
    recordAgentCall(stats, { kind: 'glance_batch', outcome: 'ok', costUsd: 0.05 });
    recordAgentCall(stats, { kind: 'glance_batch', outcome: 'ok', attempt: 2, costUsd: 0.02 });
    recordAgentCall(stats, { kind: 'dossier_update', outcome: 'ok', costUsd: 0.05 });
    recordAgentCall(stats, { kind: 'dossier_update', outcome: 'skipped_unchanged' });

    expect(formatCallStats(stats)).toBe('dossier_update 1 (1 skipped unchanged)  glance_batch 2 (1 retry)  total 3, $0.12');
    expect(formatCallStats(emptyAgentCallStats())).toBe('total 0');
  });
});

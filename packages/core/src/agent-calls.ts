import type { AgentCallCount, AgentCallKind, AgentCallOutcome, AgentCallStats } from './memory.ts';

export function emptyAgentCallStats(): AgentCallStats {
  return { total: 0, byKind: {} };
}

function emptyCount(): AgentCallCount {
  return { calls: 0, failed: 0, retries: 0, skippedUnchanged: 0, skippedByBudget: 0, durationMs: 0, costUsd: null };
}

export interface AgentCallNote {
  kind: AgentCallKind;
  outcome: AgentCallOutcome;
  /** attempt 2 counts as a retry. */
  attempt?: number;
  durationMs?: number;
  costUsd?: number | null;
}

/** Adds one call (or one skip) to the stats, in place. Skips are counted but are not calls. */
export function recordAgentCall(stats: AgentCallStats, note: AgentCallNote): void {
  const count = stats.byKind[note.kind] ?? emptyCount();
  stats.byKind[note.kind] = count;
  if (note.outcome === 'skipped_unchanged') {
    count.skippedUnchanged += 1;
    return;
  }
  if (note.outcome === 'skipped_by_budget') {
    count.skippedByBudget += 1;
    return;
  }
  count.calls += 1;
  stats.total += 1;
  if (note.outcome === 'failed') {
    count.failed += 1;
  }
  if ((note.attempt ?? 1) > 1) {
    count.retries += 1;
  }
  count.durationMs += note.durationMs ?? 0;
  if (note.costUsd !== undefined && note.costUsd !== null) {
    count.costUsd = (count.costUsd ?? 0) + note.costUsd;
  }
}

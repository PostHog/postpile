import type { AgentCallKind, AgentCallStats } from '@postpile/core';

function cost(stats: AgentCallStats): number | null {
  let total: number | null = null;
  for (const count of Object.values(stats.byKind)) {
    if (count?.costUsd !== null && count?.costUsd !== undefined) {
      total = (total ?? 0) + count.costUsd;
    }
  }
  return total;
}

/** Footer text like "4 agent calls · $0.14". Cost is left out when the backend never reported one. */
export function callStatsLabel(stats: AgentCallStats): string {
  const calls = `${stats.total} agent ${stats.total === 1 ? 'call' : 'calls'}`;
  const total = cost(stats);
  return total === null ? calls : `${calls} · $${total.toFixed(2)}`;
}

/** One line per kind for the hover title, e.g. "dossier_update: 2 calls, 1 failed". */
export function callStatsDetail(stats: AgentCallStats): string {
  const lines: string[] = [];
  for (const [kind, count] of Object.entries(stats.byKind) as [AgentCallKind, AgentCallStats['byKind'][AgentCallKind]][]) {
    if (!count) {
      continue;
    }
    const parts = [`${count.calls} ${count.calls === 1 ? 'call' : 'calls'}`];
    if (count.failed > 0) {
      parts.push(`${count.failed} failed`);
    }
    if (count.skippedByBudget > 0) {
      parts.push(`${count.skippedByBudget} skipped by the cap`);
    }
    lines.push(`${kind}: ${parts.join(', ')}`);
  }
  return lines.join('\n');
}

/** Work the call cap cut from a sync: topics, batches or PRs that wait for the next sync. */
export function skippedByCap(stats: AgentCallStats): number {
  return Object.values(stats.byKind).reduce((sum, count) => sum + (count?.skippedByBudget ?? 0), 0);
}

/**
 * "stopped at call cap: 7 left for the hourly sync", or null when the cap
 * was not reached. Without auto sync the leftovers wait for the next "Sync now".
 */
export function capNote(stats: AgentCallStats, autoSyncMinutes = 0): string | null {
  const left = skippedByCap(stats);
  if (left === 0) {
    return null;
  }
  const next = autoSyncMinutes === 60 ? 'the hourly sync' : autoSyncMinutes > 0 ? `the auto sync (every ${autoSyncMinutes} min)` : 'the next sync';
  return `stopped at call cap: ${left} left for ${next}`;
}

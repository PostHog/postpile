import type { AgentCallKind, AgentCallStats } from '@postpile/core';

/** Footer text like "4 agent calls". No cost: the user is on a subscription, and a dollar figure read like a bill (2026-09-29). */
/** "agent call" or "agent calls", for a count drawn on its own. */
export function callStatsWords(stats: AgentCallStats): string {
  return stats.total === 1 ? 'agent call' : 'agent calls';
}

export function callStatsLabel(stats: AgentCallStats): string {
  return `${stats.total} ${callStatsWords(stats)}`;
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

/** The live status' view of the next background sync: when it is due, and whether it comes early to drain a backlog. */
export interface NextSync {
  at: string | null;
  isBacklog: boolean;
}

/** Minutes until a backlog sync, at least 1; null when none is due early (auto sync off, or the full interval applies). */
export function backlogSyncMinutes(next: NextSync | null, now: Date): number | null {
  if (next === null || !next.isBacklog || next.at === null) {
    return null;
  }
  return Math.max(1, Math.ceil((new Date(next.at).getTime() - now.getTime()) / 60_000));
}

/**
 * "stopped at call cap: 7 left, next sync in 2 min" while the app drains the
 * backlog by itself, "... 7 left for the hourly sync" while the full interval
 * applies, or null when the cap was not reached. Without auto sync the
 * leftovers wait for the next "Sync now".
 */
export function capNote(stats: AgentCallStats, autoSyncMinutes: number, next: NextSync | null, now: Date): string | null {
  const left = skippedByCap(stats);
  if (left === 0) {
    return null;
  }
  const backlogMinutes = backlogSyncMinutes(next, now);
  if (backlogMinutes !== null) {
    return `stopped at call cap: ${left} left, next sync in ${backlogMinutes} min`;
  }
  const wait = autoSyncMinutes === 60 ? 'the hourly sync' : autoSyncMinutes > 0 ? `the auto sync (every ${autoSyncMinutes} min)` : 'the next sync';
  return `stopped at call cap: ${left} left for ${wait}`;
}

import type { AgentCallStats } from './memory.ts';

export interface AgentCallSummary {
  failed: number;
  costUsd: number;
  /** Some calls were skipped by the run's agent-call cap: the sync would have made more with a higher one. */
  stoppedAtCap: boolean;
}

/** Rolls the per-kind call stats into the three numbers sync_completed reports. */
export function agentCallSummary(stats: AgentCallStats): AgentCallSummary {
  let failed = 0;
  let costUsd = 0;
  let stoppedAtCap = false;
  for (const count of Object.values(stats.byKind)) {
    if (!count) {
      continue;
    }
    failed += count.failed;
    costUsd += count.costUsd ?? 0;
    stoppedAtCap ||= count.skippedByBudget > 0;
  }
  return { failed, costUsd, stoppedAtCap };
}

/**
 * Whether a finished sync's errors mention a rate limit, and which surface:
 * the GraphQL and REST error messages are shaped differently at the point
 * they are built (see packages/github), so the wording alone tells them
 * apart without threading a typed error through every layer.
 */
export function rateLimitSourceFromErrors(errors: string[]): 'graphql' | 'rest' | null {
  const hit = errors.find((line) => /rate limit/i.test(line));
  if (!hit) {
    return null;
  }
  return /failed with \d/.test(hit) ? 'rest' : 'graphql';
}

import { AsyncLocalStorage } from 'node:async_hooks';
import type { AgentCallObserver, ObservedCall } from '@postpile/agent';
import { emptyAgentCallStats, recordAgentCall, type AgentCallStats } from '@postpile/core';
import type { Store } from '@postpile/store';

/** Run id for calls made outside a sync or consolidation: chat, drafts, instructions proposals and the setup draft. */
export const ACTION_RUN_ID = 'action';

/** Run id for the daily work context sweep, which runs beside syncs and never counts toward one. */
export const SWEEP_RUN_ID = 'sweep';

/** Calls the user asks for directly; they never count toward a sync or consolidation. */
const ACTION_KINDS = new Set<ObservedCall['purpose']>(['chat', 'draft_comment', 'instructions_change', 'memory_recheck', 'setup_draft', 'setup_refine']);

interface ActiveRun {
  id: string;
  stats: AgentCallStats;
}

/**
 * The engine's AgentCallObserver. Every call becomes an agent_call row and,
 * while a sync or consolidation runs, is added to that run's stats. The
 * engine never runs a sync, a consolidation and a poll cycle at the same
 * time, so one active run (begin/end) is enough for those.
 *
 * Glance catch-up runs are the exception: they run beside poll cycles and
 * each other. withRun() scopes a run to its own async work
 * (AsyncLocalStorage follows the awaits of that work), so its calls land in
 * its stats and never in a poll cycle's, and the other way round.
 */
export class AgentCallLog implements AgentCallObserver {
  private active: ActiveRun | null = null;
  private readonly scoped = new AsyncLocalStorage<ActiveRun>();

  constructor(
    private readonly store: Store,
    private readonly now: () => Date,
  ) {}

  begin(runId: string): AgentCallStats {
    const stats = emptyAgentCallStats();
    this.active = { id: runId, stats };
    return stats;
  }

  end(): void {
    this.active = null;
  }

  /** Runs work as its own run: calls made inside it count there, whatever begin/end says meanwhile. */
  withRun<T>(runId: string, stats: AgentCallStats, work: () => Promise<T>): Promise<T> {
    return this.scoped.run({ id: runId, stats }, work);
  }

  private runFor(call: ObservedCall): ActiveRun | null {
    if (ACTION_KINDS.has(call.purpose) || call.purpose === 'context_sweep') {
      return null;
    }
    return this.scoped.getStore() ?? this.active;
  }

  onCall(call: ObservedCall): void {
    const run = this.runFor(call);
    this.store.agentCalls.add({
      runId: call.purpose === 'context_sweep' ? SWEEP_RUN_ID : (run?.id ?? ACTION_RUN_ID),
      kind: call.purpose,
      topicId: call.topicId,
      model: call.model,
      ok: call.ok,
      attempt: call.attempt,
      durationMs: call.durationMs,
      costUsd: call.costUsd,
      at: this.now().toISOString(),
    });
    if (run) {
      recordAgentCall(run.stats, {
        kind: call.purpose,
        outcome: call.ok ? 'ok' : 'failed',
        attempt: call.attempt,
        durationMs: call.durationMs,
        costUsd: call.costUsd,
      });
    }
  }
}

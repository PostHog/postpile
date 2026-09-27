import { emptyAgentCallStats, recordAgentCall, type AgentCallKind, type AgentCallStats } from '@code-manager/core';

/**
 * Caps agent calls per sync and counts them by kind. take() is synchronous,
 * so parallel calls cannot overshoot the cap. A granted take counts as a
 * call; failures, duration and cost are not known here (engine memory v2
 * moves that part to the AgentCallObserver, see DESIGN.md).
 */
export class AgentBudget {
  readonly stats: AgentCallStats = emptyAgentCallStats();

  constructor(private readonly max: number) {}

  take(kind: AgentCallKind): boolean {
    if (this.stats.total >= this.max) {
      recordAgentCall(this.stats, { kind, outcome: 'skipped_by_budget' });
      return false;
    }
    recordAgentCall(this.stats, { kind, outcome: 'ok' });
    return true;
  }

  get calls(): number {
    return this.stats.total;
  }
}

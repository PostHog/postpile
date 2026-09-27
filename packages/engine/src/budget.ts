import { recordAgentCall, type AgentCallKind, type AgentCallStats } from '@code-manager/core';

/**
 * Caps agent calls per run. take() is synchronous, so parallel calls cannot
 * overshoot the cap. Calls themselves are counted by the AgentCallLog (it
 * knows about failures, duration and cost); the budget only adds the skips
 * to the same stats.
 */
export class AgentBudget {
  private granted = 0;

  constructor(
    private readonly max: number,
    private readonly stats: AgentCallStats,
  ) {}

  take(kind: AgentCallKind): boolean {
    if (this.granted >= this.max) {
      recordAgentCall(this.stats, { kind, outcome: 'skipped_by_budget' });
      return false;
    }
    this.granted += 1;
    return true;
  }

  /** Work whose input hash matched the stored answer. Not a call, only counted. */
  skipUnchanged(kind: AgentCallKind): void {
    recordAgentCall(this.stats, { kind, outcome: 'skipped_unchanged' });
  }
}

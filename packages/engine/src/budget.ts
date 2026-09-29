import { recordAgentCall, type AgentCallKind, type AgentCallStats } from '@postpile/core';

/** A second limit on top of a run's cap, e.g. the daily catch-up cap. take() counts the call when it says yes. */
export interface CallAllowance {
  take(): boolean;
}

/**
 * Caps agent calls per run. take() is synchronous, so parallel calls cannot
 * overshoot the cap. Calls themselves are counted by the AgentCallLog (it
 * knows about failures, duration and cost); the budget only adds the skips
 * to the same stats. An optional daily allowance is asked only after the
 * run's own cap said yes, so a refused call never uses up a daily one.
 */
export class AgentBudget {
  private grantedCalls = 0;
  private dailyCapHit = false;

  constructor(
    private readonly max: number,
    private readonly stats: AgentCallStats,
    private readonly daily: CallAllowance | null = null,
  ) {}

  take(kind: AgentCallKind): boolean {
    const overRun = this.grantedCalls >= this.max;
    const overDaily = !overRun && this.daily !== null && !this.daily.take();
    if (overRun || overDaily) {
      this.dailyCapHit ||= overDaily;
      recordAgentCall(this.stats, { kind, outcome: 'skipped_by_budget' });
      return false;
    }
    this.grantedCalls += 1;
    return true;
  }

  /** Calls granted so far, for live progress. */
  granted(): number {
    return this.grantedCalls;
  }

  /** True once the daily allowance refused a call; glance gaps then say daily_cap. */
  stoppedByDailyCap(): boolean {
    return this.dailyCapHit;
  }

  /** Work whose input hash matched the stored answer. Not a call, only counted. */
  skipUnchanged(kind: AgentCallKind): void {
    recordAgentCall(this.stats, { kind, outcome: 'skipped_unchanged' });
  }
}

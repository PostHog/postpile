import { SWEEP_CHECK_MS, sweepDue, type SweepHistory, type Timers, type WorkContextSweepResult } from '@code-manager/core';

export interface SweepTarget {
  history(): SweepHistory;
  isRunning(): boolean;
  sweep(): Promise<WorkContextSweepResult>;
}

/**
 * Runs the work context sweep while the desktop app runs: checks at start
 * and every SWEEP_CHECK_MS whether one is due (sweepDue: morning or later, no
 * success in 24h, no failure in 2h). The sweep runs in the background; the
 * timer never waits for it.
 */
export class WorkContextSchedule {
  private timer: unknown = null;
  private stopped = true;

  constructor(
    private readonly target: SweepTarget,
    private readonly timers: Timers,
    private readonly now: () => Date,
  ) {}

  start(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.check();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private check(): void {
    if (this.stopped) {
      return;
    }
    if (!this.target.isRunning() && sweepDue(this.now(), this.target.history())) {
      // The sweeper records its own failures; nothing to handle here.
      void this.target.sweep();
    }
    this.timer = this.timers.setTimeout(() => this.check(), SWEEP_CHECK_MS);
  }
}

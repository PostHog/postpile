/**
 * Caps agent calls per sync. take() is synchronous, so parallel glances
 * cannot overshoot the cap.
 */
export class AgentBudget {
  private used = 0;

  constructor(private readonly max: number) {}

  take(): boolean {
    if (this.used >= this.max) {
      return false;
    }
    this.used += 1;
    return true;
  }

  get calls(): number {
    return this.used;
  }
}

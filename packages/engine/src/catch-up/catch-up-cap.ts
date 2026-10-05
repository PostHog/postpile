import type { CallAllowance } from '../budget.ts';

/** Catch-up agent calls per rolling 24 hours, unless POSTPILE_CATCHUP_CAP says otherwise. */
export const CATCH_UP_CALLS_PER_DAY = 600;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The daily safety cap on glance catch-up calls: a rolling 24h window, kept
 * in memory (a restart starts it over, which is fine for a runaway guard).
 * Every granted call counts, failed ones included. 0 turns catch-up off.
 */
export class CatchUpCap implements CallAllowance {
  private readonly grantedAt: number[] = [];

  constructor(
    readonly perDay: number,
    private readonly now: () => Date,
  ) {}

  private dropOld(): void {
    const since = this.now().getTime() - DAY_MS;
    while (this.grantedAt.length > 0 && this.grantedAt[0]! <= since) {
      this.grantedAt.shift();
    }
  }

  remaining(): number {
    this.dropOld();
    return Math.max(this.perDay - this.grantedAt.length, 0);
  }

  take(): boolean {
    if (this.remaining() === 0) {
      return false;
    }
    this.grantedAt.push(this.now().getTime());
    return true;
  }
}

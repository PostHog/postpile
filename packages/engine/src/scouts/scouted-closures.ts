import { scoutClosedOutcome, scoutPrClosedProps } from '@postpile/core';
import type { Store } from '@postpile/store';
import type { Telemetry } from '../telemetry/telemetry.ts';

/**
 * The one place that sends scout_pr_closed (DESIGN.md "Usage analytics" ›
 * Scouts): once per scouted PR, when it leaves the Scouted section.
 *
 * Follow, dismiss and expiry are each stored in their own place (the undo
 * queue or the lock's queue, the dismiss action, the sync's expiry), and a
 * PR reaching the inbox by itself is not stored at all: it just gets a
 * thread, a found row or a topic. So instead of hooking each of those, this
 * sweep reads every row not yet recorded as left, decides how it left from
 * the row (`scoutClosedOutcome`), and sends the event in the same step that
 * sets `left_section_at`, which only ever goes from null to a time: one
 * event per PR, also across restarts.
 *
 * Runs after every sync, a dismiss, a Follow GitHub took, and a send from
 * the lock. Never throws: telemetry never breaks what called it.
 */
export class ScoutedClosures {
  constructor(
    private readonly store: Store,
    private readonly telemetry: Telemetry,
    private readonly now: () => Date,
    private readonly log: (line: string) => void,
  ) {}

  report(): void {
    try {
      const now = this.now().toISOString();
      for (const leaving of this.store.scoutedPrs.listNotLeft()) {
        const closed = scoutClosedOutcome(leaving, now);
        if (closed === null) {
          continue;
        }
        if (this.store.scoutedPrs.markLeftSection(leaving.scouted.prKey, closed.at)) {
          this.telemetry.capture('scout_pr_closed', scoutPrClosedProps(leaving, closed.outcome, closed.at));
        }
      }
    } catch (error) {
      this.log(`scouts: closed report failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

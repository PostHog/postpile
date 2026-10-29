import { scoutClosedOutcome, scoutPrClosedProps } from '@postpile/core';
import type { Store } from '@postpile/store';
import type { Telemetry } from '../telemetry/telemetry.ts';
import { ScoutSectionTracking } from './section-tracking.ts';

/**
 * The one place that sends scout_pr_closed (DESIGN.md "Usage analytics" ›
 * Scouts): once per scouted PR, for its first exit from the Scouted
 * section.
 *
 * Follow, dismiss and expiry are each stored in their own place (the undo
 * queue or the lock's queue, the dismiss action, the sync's expiry), and a
 * PR reaching the inbox by itself is not stored at all: it, or a layer of
 * its stack, just gets a thread, a found row or a topic
 * (`ScoutSectionTracking`, the section's own rule). So instead of hooking
 * each of those, this sweep reads every row not yet reported, decides how
 * it left (`scoutClosedOutcome`) and marks `closure_reported_at` before it
 * captures. Best effort: at most one event per PR, and a crash between the
 * two loses that one.
 *
 * Runs right after the sync's inbox fetch (before scout expiry, so a PR
 * that reached the inbox is not relabelled expired), after every sync, a
 * dismiss, a Follow GitHub took, and a send from the lock. Never throws:
 * telemetry never breaks what called it.
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
      const unreported = this.store.scoutedPrs.listClosureUnreported();
      if (unreported.length === 0) {
        return;
      }
      const now = this.now().toISOString();
      const tracking = ScoutSectionTracking.load(this.store);
      for (const { scouted, prUpdatedAt } of unreported) {
        const leaving = { scouted, prUpdatedAt, tracked: tracking.tracks(scouted.prKey) };
        const closed = scoutClosedOutcome(leaving, now);
        if (closed === null) {
          continue;
        }
        if (this.store.scoutedPrs.markClosureReported(scouted.prKey, now)) {
          this.telemetry.capture('scout_pr_closed', scoutPrClosedProps(leaving, closed.outcome, closed.at));
        }
      }
    } catch (error) {
      this.log(`scouts: closed report failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

import type { Store } from '@postpile/store';
import type { Telemetry } from './telemetry.ts';

/** At most one pings_summarized event per this long. */
export const PING_SUMMARY_EVERY_MS = 60 * 60_000;

/** Meta key: the end of the window the last summary covered (ISO). */
export const PING_SUMMARY_META_KEY = 'pings_summarized_at';

/**
 * The hourly pings_summarized event (DESIGN.md "Usage analytics"): how many
 * ping decisions pinged or were withheld by the rules or the agent, and how
 * many threads were handled quietly, since the last summary. Counts only,
 * read from ping_decision and the action log, so nothing is kept in memory
 * and a restart loses nothing. A window with nothing in it sends nothing.
 * The first call only starts the clock, so an update never sends the whole
 * history.
 */
export class PingSummary {
  constructor(
    private readonly store: Store,
    private readonly telemetry: Telemetry,
    private readonly now: () => Date,
  ) {}

  sendIfDue(): void {
    const until = this.now().toISOString();
    const since = this.store.meta.get(PING_SUMMARY_META_KEY);
    if (since === null) {
      this.store.meta.set(PING_SUMMARY_META_KEY, until);
      return;
    }
    if (new Date(until).getTime() - new Date(since).getTime() < PING_SUMMARY_EVERY_MS) {
      return;
    }
    const decisions = this.store.pingDecisions.countBetween(since, until);
    const quiet = this.store.actionLog
      .listByOriginSince('quiet', since)
      .filter((entry) => entry.action === 'mark_read' && entry.outcome === 'github' && entry.at <= until).length;
    const props = {
      pinged: decisions.pinged,
      withheld_rules: decisions.withheldRules,
      withheld_agent: decisions.withheldAgent,
      handled_quietly: quiet,
    };
    // The window moves on either way: an empty hour has nothing to add to the next summary.
    this.store.meta.set(PING_SUMMARY_META_KEY, until);
    if (props.pinged + props.withheld_rules + props.withheld_agent + props.handled_quietly > 0) {
      this.telemetry.capture('pings_summarized', props);
    }
  }
}

import type { Ping, PrEvent, Viewer } from '@postpile/core';
import type { PingDecider } from './ping-decider.ts';

/**
 * Pings for events the events agent raised to loud after the poll decided
 * them (DESIGN.md "Live poll and Mac pings"). Told by the event classifier
 * in a catch-up run or a full sync (`DigestDeps.onEventsRaised`); the
 * decision runs right away (`PingDecider.decideRaised`), and the pings wait
 * here until the live poller hands them to the Mac (`drain`, next poll
 * cycle), like Look closer pings.
 */
export class RaisedPings {
  private waiting: Ping[] = [];

  constructor(private readonly decider: PingDecider) {}

  /** The decider's errors, for the run's report. */
  async afterRaised(events: PrEvent[], viewer: Viewer): Promise<string[]> {
    if (events.length === 0) {
      return [];
    }
    const decided = await this.decider.decideRaised(events, viewer);
    this.waiting.push(...decided.pings);
    return decided.errors;
  }

  /** The pings waiting for the Mac, once. */
  drain(): Ping[] {
    const pings = this.waiting;
    this.waiting = [];
    return pings;
  }
}

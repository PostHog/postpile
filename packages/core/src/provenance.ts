import { isMadeByAutomation } from './bots.ts';
import type { EventKind, FoundPr, NotificationThread, PingReason, PrEvent, Provenance } from './types.ts';

// Event kinds that mean GitHub notified the viewer, even when the
// notification thread has not been synced yet.
const pingKinds: Partial<Record<EventKind, PingReason>> = {
  mention: 'mention',
  question_to_user: 'mention',
  team_mention: 'team_mention',
  review_requested: 'review_requested',
};

function pingFromEvents(events: PrEvent[]): PingReason | null {
  for (const event of events) {
    const reason = pingKinds[event.kind];
    if (!reason) {
      continue;
    }
    // A review request counts by whom it asks, whoever clicked it
    // (`isAutomation`). The rule already decided that: loud means it asks the
    // viewer or their team.
    if (event.kind === 'review_requested') {
      if (event.ruleLoudness === 'loud') {
        return reason;
      }
      continue;
    }
    if (isMadeByAutomation(event)) {
      continue;
    }
    return reason;
  }
  return null;
}

/**
 * A PR is pinged whenever GitHub notified the user about it, no matter how it
 * got into the tile. So a pulled-in or found PR that later gets a
 * notification flips to pinged without anyone having to update it. Events
 * cover the gap before the notification thread shows up in a sync, but not
 * for a found PR: it is not in the inbox, so its events stay no ping.
 */
export function provenanceFor(
  thread: NotificationThread | null,
  pulledInReason: string,
  events: PrEvent[] = [],
  found: FoundPr | null = null,
): Provenance {
  if (thread) {
    return { kind: 'pinged', reason: thread.reason };
  }
  if (found) {
    return { kind: 'found', via: found.via, reason: found.reason };
  }
  const reason = pingFromEvents(events);
  if (reason) {
    return { kind: 'pinged', reason };
  }
  return { kind: 'pulled_in', reason: pulledInReason };
}

/**
 * Pinged or found: the user's own work, as opposed to a pulled-in stack
 * layer. Such a PR keeps its tile, gets a glance, a turn and a place in the
 * queues.
 */
export function isTracked(provenance: Provenance): boolean {
  return provenance.kind !== 'pulled_in';
}

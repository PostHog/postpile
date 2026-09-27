import type { EventKind, NotificationThread, PingReason, PrEvent, Provenance } from './types.ts';

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
    if (!reason || event.isBot) {
      continue;
    }
    // review_requested is only a ping when it was for the viewer, which the
    // rule already decided.
    if (event.kind === 'review_requested' && event.ruleLoudness !== 'loud') {
      continue;
    }
    return reason;
  }
  return null;
}

/**
 * A PR is pinged whenever GitHub notified the user about it, no matter how it
 * got into the tile. So a pulled-in PR that later gets a mention flips to
 * pinged without anyone having to update it. Events cover the gap before the
 * notification thread shows up in a sync.
 */
export function provenanceFor(
  thread: NotificationThread | null,
  pulledInReason: string,
  events: PrEvent[] = [],
): Provenance {
  if (thread) {
    return { kind: 'pinged', reason: thread.reason };
  }
  const reason = pingFromEvents(events);
  if (reason) {
    return { kind: 'pinged', reason };
  }
  return { kind: 'pulled_in', reason: pulledInReason };
}

export function isPinged(provenance: Provenance): boolean {
  return provenance.kind === 'pinged';
}

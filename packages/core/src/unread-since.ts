// "Unread since you looked" in pr_context's full answer (DESIGN.md "Agents
// mark read"): every event a mark-read would mark seen, straight from the
// stored seen state, the same rule planRead uses. Nothing folded, muted,
// summarised away or capped: mark_read's seen_through may only cover what
// this list showed.
import { personTextBody } from './activity.ts';
import { unseenUpTo } from './read-plan.ts';
import type { EventKind, FullPr, IsoTime, PrEvent } from './types.ts';

export interface UnreadEvent {
  id: string;
  kind: EventKind;
  actor: string;
  isBot: boolean;
  at: IsoTime;
  /** One line, as stored. */
  summary: string;
  /** A person's comment, reply or review: its whole text. Null for bots, pushes, state changes and a review without text. */
  body: string | null;
}

/** The PR's unseen events, oldest first, with the whole text of people's comments, replies and reviews. */
export function unreadSinceLooked(events: PrEvent[], pr: FullPr | null): UnreadEvent[] {
  const unseen = new Set(unseenUpTo(events, null));
  return events
    .filter((event) => unseen.has(event.id))
    .toSorted((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
    .map((event) => ({
      id: event.id,
      kind: event.kind,
      actor: event.actor,
      isBot: event.isBot,
      at: event.at,
      summary: event.summary,
      body: personTextBody(event, pr),
    }));
}

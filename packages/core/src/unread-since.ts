// "Unread since you looked" in pr_context's full answer, a reading aid
// (DESIGN.md "Agents mark read"): every event a mark-read would mark seen,
// straight from the stored seen state, the same rule planRead uses.
// People's comments, replies and reviews are listed one by one with their
// whole text; bots, CI, pushes and repeated events without text fold into
// one row per actor and kind (`unreadRows`). Unfolded, a PR with 259 unread
// events, most of them CI, made the answer too big for an agent's tool
// output (0.28.6).
import { isPersonTalk, personTextBody } from './activity.ts';
import { PUSH_KINDS } from './kinds.ts';
import { unseenUpTo } from './read-plan.ts';
import type { EventKind, FullPr, IsoTime, PrEvent } from './types.ts';

export interface UnreadEvent {
  id: string;
  kind: EventKind;
  actor: string;
  isBot: boolean;
  /** A person's comment, reply, mention or review: never folded, its text shown whole. */
  personTalk: boolean;
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
      personTalk: isPersonTalk(event),
      at: event.at,
      summary: event.summary,
      body: personTextBody(event, pr),
    }));
}

/** Other events of one actor and kind fold once there are more than this many. */
export const UNREAD_REPEAT_FOLD = 3;

/**
 * One row of the list: an event on its own, or several of one actor folded
 * into a count with the time range they span.
 */
export type UnreadRow =
  | { kind: 'event'; event: UnreadEvent }
  | { kind: 'folded'; actor: string; what: string; count: number; from: IsoTime; to: IsoTime; ids: string[] };

/** What a folded row stands for: every push of a pusher together, else one kind. */
function foldKey(event: UnreadEvent): string {
  return PUSH_KINDS.includes(event.kind) ? `${event.actor}\npush` : `${event.actor}\n${event.kind}`;
}

function foldWhat(event: UnreadEvent, count: number): string {
  if (PUSH_KINDS.includes(event.kind)) {
    return count === 1 ? 'push' : 'pushes';
  }
  return `${event.kind.replaceAll('_', ' ')} ${count === 1 ? 'event' : 'events'}`;
}

/** Bots and pushes always fold; other events without text fold when one actor repeats one kind more than UNREAD_REPEAT_FOLD times. */
function folds(event: UnreadEvent, groupSize: number): boolean {
  if (event.personTalk) {
    return false;
  }
  return event.isBot || PUSH_KINDS.includes(event.kind) || groupSize > UNREAD_REPEAT_FOLD;
}

/**
 * The list as pr_context prints it, oldest first: people's talk one row
 * each, automation folded per actor and kind. A folded row sits where its
 * first event would; every event is in exactly one row.
 */
export function unreadRows(unread: UnreadEvent[]): UnreadRow[] {
  const groups = new Map<string, UnreadEvent[]>();
  for (const event of unread) {
    const key = foldKey(event);
    const group = groups.get(key);
    if (group) {
      group.push(event);
    } else {
      groups.set(key, [event]);
    }
  }
  const rows: UnreadRow[] = [];
  const placed = new Set<string>();
  for (const event of unread) {
    const key = foldKey(event);
    const group = groups.get(key) ?? [event];
    if (!folds(event, group.length)) {
      rows.push({ kind: 'event', event });
      continue;
    }
    if (placed.has(key)) {
      continue;
    }
    placed.add(key);
    const folded = group.filter((member) => folds(member, group.length));
    rows.push({
      kind: 'folded',
      actor: event.actor,
      what: foldWhat(event, folded.length),
      count: folded.length,
      from: folded[0]?.at ?? event.at,
      to: folded.at(-1)?.at ?? event.at,
      ids: folded.map((member) => member.id),
    });
  }
  return rows;
}

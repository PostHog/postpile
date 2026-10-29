// "Waiting on you for N working days": how long a move has sat on the
// viewer, as a quiet marker on the tile footer and the topic row. Rules
// only; it never changes order, loudness or pings. DESIGN.md "Waiting on
// you for days" has the rule.
import type { TopicMove } from './topic-urgency.ts';
import type { IsoTime, TileStateKind } from './types.ts';
import type { WhoseTurn } from './whose-turn.ts';

/** The marker shows once a move has waited this many working days. */
export const WAIT_MARKER_MIN_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days since 1970-01-01 in UTC: one number per UTC calendar date. */
function utcDayNumber(ms: number): number {
  return Math.floor(ms / DAY_MS);
}

function isWeekday(dayNumber: number): boolean {
  const weekday = new Date(dayNumber * DAY_MS).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

/**
 * Working days (Monday to Friday) from `since` to `now`, by UTC calendar
 * date: every weekday after the day of `since`, up to and including the
 * day of `now`. Same day is 0, Friday to Monday is 1, Monday to Thursday
 * is 3. 0 for a `since` in the future or one that does not parse.
 */
export function workingDaysBetween(since: IsoTime, now: Date): number {
  const start = utcDayNumber(Date.parse(since));
  const end = utcDayNumber(now.getTime());
  let days = 0;
  for (let day = start + 1; day <= end; day += 1) {
    if (isWeekday(day)) {
      days += 1;
    }
  }
  return days;
}

/** The working days a move has waited, when that reaches `WAIT_MARKER_MIN_DAYS`; null below it or without a `since`. */
export function waitMarkerDays(since: IsoTime | null | undefined, now: Date): number | null {
  if (!since) {
    return null;
  }
  const days = workingDaysBetween(since, now);
  return days >= WAIT_MARKER_MIN_DAYS ? days : null;
}

/**
 * The tile footer's marker: the viewer's move, not merging (it is never
 * urgent) and not on a snoozed or done tile. Drafts carry no `since`, so
 * they never show one.
 */
export function tileWaitDays(turn: WhoseTurn, state: TileStateKind, now: Date): number | null {
  if (turn.kind !== 'you' || turn.move === 'merge') {
    return null;
  }
  if (state === 'snoozed' || state === 'done') {
    return null;
  }
  return waitMarkerDays(turn.since, now);
}

/**
 * The topic row's marker: the oldest wait among the topic's moves
 * (`TopicListItem.yourMoves`: live tiles only, so snoozed and done ones
 * are already out). Merge moves never count.
 */
export function topicWaitDays(moves: TopicMove[], now: Date): number | null {
  let oldest: IsoTime | null = null;
  for (const move of moves) {
    if (move.move === 'merge' || !move.since) {
      continue;
    }
    if (oldest === null || move.since < oldest) {
      oldest = move.since;
    }
  }
  return waitMarkerDays(oldest, now);
}

// Interruptions (2026-10-05): when PostPile may show a Mac notification.
// PostPile is a helper that cuts noise, so the default is never: the list
// waits until the user comes to it. In batches, the pings of the day wait
// for a short roundup three times a day (a field study found three batches
// a day beat both instant notifications and none). As soon as it matters
// is the live ping as it was before. Rules only, no IO; DESIGN.md
// "Interruptions" has the whole flow.
import type { MacNotification, Ping } from './pings.ts';
import type { IsoTime } from './types.ts';

export type InterruptionsMode = 'never' | 'batches' | 'asap';

export const INTERRUPTIONS_MODES: readonly InterruptionsMode[] = ['never', 'batches', 'asap'];

/** Nothing pops up until the user picks otherwise, in setup or in the sidebar. */
export const DEFAULT_INTERRUPTIONS: InterruptionsMode = 'never';

export interface RoundupTime {
  hour: number;
  minute: number;
}

/** Local times of the roundups, Monday to Friday. */
export const ROUNDUP_TIMES: readonly RoundupTime[] = [
  { hour: 9, minute: 30 },
  { hour: 13, minute: 30 },
  { hour: 16, minute: 30 },
];

/** How far back `latestRoundup` looks: covers a long weekend with the Mac asleep. */
const ROUNDUP_LOOKBACK_DAYS = 7;

/** Titles a roundup lists before "and N more". */
const ROUNDUP_LINES = 3;

/**
 * A ping PostPile holds on to, one per PR: queued for the next roundup
 * (`shownAt` null), or shown and not handled yet, which the Dock badge
 * counts. Opening its tile, or the PR turning read, drops it.
 */
export interface MacPingRecord {
  ping: Ping;
  queuedAt: IsoTime;
  shownAt: IsoTime | null;
}

export interface InterruptionsView {
  mode: InterruptionsMode;
  /** The roundup times as the UI shows them, e.g. "9:30". */
  roundupTimes: string[];
}

export function isInterruptionsMode(value: unknown): value is InterruptionsMode {
  return typeof value === 'string' && (INTERRUPTIONS_MODES as readonly string[]).includes(value);
}

/** A stored value, or the default when it is missing or unknown. */
export function interruptionsModeOf(stored: string | null): InterruptionsMode {
  return isInterruptionsMode(stored) ? stored : DEFAULT_INTERRUPTIONS;
}

export function roundupTimeLabel(time: RoundupTime): string {
  return `${time.hour}:${String(time.minute).padStart(2, '0')}`;
}

export function interruptionsView(mode: InterruptionsMode): InterruptionsView {
  return { mode, roundupTimes: ROUNDUP_TIMES.map(roundupTimeLabel) };
}

function isWeekday(day: Date): boolean {
  const weekday = day.getDay();
  return weekday !== 0 && weekday !== 6;
}

/**
 * The latest roundup at or before `now`, in local time, weekdays only.
 * Null when none falls in the last week. A roundup the Mac slept through
 * is still the latest one, so its pings go out on wake.
 */
export function latestRoundup(now: Date): Date | null {
  for (let daysBack = 0; daysBack <= ROUNDUP_LOOKBACK_DAYS; daysBack += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack);
    if (!isWeekday(day)) {
      continue;
    }
    for (let index = ROUNDUP_TIMES.length - 1; index >= 0; index -= 1) {
      const time = ROUNDUP_TIMES[index]!;
      const slot = new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.hour, time.minute);
      if (slot.getTime() <= now.getTime()) {
        return slot;
      }
    }
  }
  return null;
}

/**
 * One notification for a roundup: a single ping as it is, more as
 * "3 things need you" with the first titles, personal asks first. A
 * roundup never bounces the Dock (`personal` false): it is the calm mode.
 */
export function roundupNotification(pings: Ping[]): MacNotification {
  const ordered = [...pings.filter((ping) => ping.personal), ...pings.filter((ping) => !ping.personal)];
  const first = ordered[0]!;
  if (ordered.length === 1) {
    return { title: first.title, body: first.body, target: first.target, prKeys: [first.target.prKey], count: 1, personal: false };
  }
  const lines = ordered.slice(0, ROUNDUP_LINES).map((ping) => ping.title);
  const more = ordered.length - lines.length;
  if (more > 0) {
    lines.push(`and ${more} more`);
  }
  return {
    title: `${ordered.length} things need you`,
    body: lines.join('\n'),
    target: first.target,
    prKeys: ordered.map((ping) => ping.target.prKey),
    count: ordered.length,
    personal: false,
  };
}

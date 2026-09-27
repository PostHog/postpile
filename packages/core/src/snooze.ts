import type { IsoTime, Pr, PrEvent, Snooze } from './types.ts';

export interface SnoozeContext {
  prs: Pr[];
  events: PrEvent[];
  now: IsoTime;
}

/** True once the snooze condition is met: a human reply, a push, green CI, or the time passed. */
export function isSnoozeOver(_snooze: Snooze, _context: SnoozeContext): boolean {
  throw new Error('not implemented');
}

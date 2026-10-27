// When something last happened on a PR, a tile or a topic, as the tie-break
// of the sidebar and tile order (DESIGN.md "Ownership sections" › Inside a
// section, "Groups inside a topic"; 2026-10-27). Only other people's activity
// counts: the viewer reading, approving, replying or snoozing must never move
// a topic or tile up. "Activity" is what topic memory counts as a newer event
// (`isMemoryTrigger`): loud news, a person's event, a state change. Muted
// events, bot talk, pushes and bot comments that only ride along stay out.
// Rules only, no IO.
import { isMemoryTrigger } from './event-roles.ts';
import { isOwnEvent } from './last-touch.ts';
import type { IsoTime, PrEvent, Viewer } from './types.ts';

/** Events PostPile makes itself (the agent's Look closer flag): never GitHub activity. */
const APP_MADE_KINDS: readonly PrEvent['kind'][] = ['look_closer'];

/** Someone else did something on GitHub that counts as news for the order. */
export function isOthersActivity(event: PrEvent, viewer: Viewer | null): boolean {
  if (APP_MADE_KINDS.includes(event.kind)) {
    return false;
  }
  if (viewer !== null && isOwnEvent(event, viewer)) {
    return false;
  }
  return isMemoryTrigger(event);
}

/** The newest of other people's activity among these events, null when there is none. */
export function othersActivityAt(events: readonly PrEvent[], viewer: Viewer | null): IsoTime | null {
  let newest: IsoTime | null = null;
  for (const event of events) {
    if (!isOthersActivity(event, viewer)) {
      continue;
    }
    if (newest === null || event.at > newest) {
      newest = event.at;
    }
  }
  return newest;
}

/** The newest of several activity times (a topic's tiles), null when none has one. */
export function newestActivity(times: readonly (IsoTime | null)[]): IsoTime | null {
  let newest: IsoTime | null = null;
  for (const at of times) {
    if (at !== null && (newest === null || at > newest)) {
      newest = at;
    }
  }
  return newest;
}

/** Newest activity first; no activity at all goes last. 0 on a tie. */
export function compareByActivity(a: IsoTime | null, b: IsoTime | null): number {
  if (a === b) {
    return 0;
  }
  if (a === null) {
    return 1;
  }
  if (b === null) {
    return -1;
  }
  return a > b ? -1 : 1;
}

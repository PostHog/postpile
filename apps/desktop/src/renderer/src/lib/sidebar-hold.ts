// The sidebar's held row (B-A-16, owner 2026-10-11): a topic keeps its row
// while it is selected ("Marked when you move on"). A click on another topic
// used to release that row at once, so the rows below moved up while the
// pointer was on its way. Now a change made while the pointer is over the
// sidebar keeps the previous hold until the pointer leaves the sidebar; the
// rows then slide to their new places.

import type { HoldRequest } from './hold-place.ts';

/** What the sidebar holds in place: the selected tile's hold key (`useHeldPlaces`) and the open topic. */
export interface SidebarHold {
  key: string | null;
  topicId: string | null;
}

function sameHold(a: SidebarHold, b: SidebarHold): boolean {
  return a.key === b.key && a.topicId === b.topicId;
}

/**
 * The holds kept from before, after the selection went from `last` to
 * `current`, oldest first: while the pointer is over the sidebar every row
 * it left stays (clicking on through more rows keeps them all, the one
 * selected again drops out); with the pointer outside nothing is kept.
 */
export function nextKeptHolds(kept: SidebarHold[], last: SidebarHold, current: SidebarHold, pointerInside: boolean): SidebarHold[] {
  if (!pointerInside) {
    return [];
  }
  if (sameHold(last, current)) {
    return kept;
  }
  const others = kept.filter((hold) => hold.topicId !== current.topicId && hold.topicId !== last.topicId);
  return last.topicId === current.topicId ? others : [...others, last];
}

/**
 * The rows `useHeldPlaces` holds in place: every kept row, oldest first,
 * then the current selection's, each under the key it was selected with,
 * so a row keeps the place it had while it was selected until the pointer
 * leaves the sidebar. A hold without a selected tile holds no place.
 */
export function heldRows(current: SidebarHold, kept: SidebarHold[]): HoldRequest[] {
  return [...kept, current].flatMap((hold) => (hold.key !== null && hold.topicId !== null ? [{ key: hold.key, itemId: hold.topicId }] : []));
}

/** The topics whose rows stay put: the selected one and every kept one. */
export function keptTopicIds(current: SidebarHold, kept: SidebarHold[]): string[] {
  return [current.topicId, ...kept.map((hold) => hold.topicId)].filter((id): id is string => id !== null);
}

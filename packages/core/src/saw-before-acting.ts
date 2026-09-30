// "Did the viewer read it before they acted?" An action alone (a comment
// from the CLI, marking a PR ready seconds after someone else commented)
// does not say the viewer saw what came before it. Only a real read does:
// GitHub's read time of the thread, or PostPile's Mark read or opened read
// (`handledAt`). Events that turned seen only because the viewer acted do
// not count. One home for the acted-after quiet read and for "handled"
// without a click. Rules only, no IO. DESIGN.md "You already dealt with it"
// › Read before acting (2026-09-30).
import { isAutomation } from './bots.ts';
import { isOwnEvent, touchKindOf, type TouchKind } from './last-touch.ts';
import { reviewRequestTarget } from './review-request.ts';
import type { IsoTime, Pr, PrEvent, Viewer } from './types.ts';

/** The viewer's reads PostPile keeps: GitHub's read time of the PR's thread, and its own Mark read or opened read. */
export interface ReadStamps {
  lastReadAt: IsoTime | null;
  handledAt: IsoTime | null;
}

/** A person's event: not the viewer's own, not automation (a bot-made review request that asks the viewer is a person's). */
function isPersonsEvent(event: PrEvent, pr: Pr, viewer: Viewer): boolean {
  return !isOwnEvent(event, viewer) && !isAutomation(event, reviewRequestTarget(event, pr), viewer);
}

/**
 * The viewer saw `event` before acting at `actionAt`: a read at or after
 * the event and at or before the action covers it. The viewer's own events
 * and automation need no read.
 */
export function sawBeforeActing(event: PrEvent, actionAt: IsoTime, reads: ReadStamps, pr: Pr, viewer: Viewer): boolean {
  if (!isPersonsEvent(event, pr, viewer)) {
    return true;
  }
  return [reads.lastReadAt, reads.handledAt].some((read) => read !== null && read >= event.at && read <= actionAt);
}

/** Every person's event before `actionAt` passes `sawBeforeActing`. */
export function sawEverythingBefore(events: PrEvent[], actionAt: IsoTime, reads: ReadStamps, pr: Pr, viewer: Viewer): boolean {
  return events.filter((event) => event.at < actionAt).every((event) => sawBeforeActing(event, actionAt, reads, pr, viewer));
}

/** Own activity that can handle a PR: a comment, a review, a push to their own PR. Merging or closing ends the PR instead. */
const HANDLING_TOUCHES: readonly TouchKind[] = ['changes_request', 'approval', 'review', 'comment', 'push'];

/** When the viewer last acted on the PR (`HANDLING_TOUCHES`, or marking it ready for review); null when never. */
function newestOwnActivity(pr: Pr, events: PrEvent[], viewer: Viewer): IsoTime | null {
  let newest: IsoTime | null = null;
  for (const event of events) {
    const touch = touchKindOf(event, pr, viewer);
    const acted = (touch !== null && HANDLING_TOUCHES.includes(touch)) || (event.kind === 'ready_for_review' && isOwnEvent(event, viewer));
    if (acted && (newest === null || event.at > newest)) {
      newest = event.at;
    }
  }
  return newest;
}

/**
 * The viewer dealt with the PR without a click: their newest own activity
 * (a comment, a review, a push to their own PR, marking it ready) comes
 * after the newest person's event, and they read every person's event
 * before it (`sawBeforeActing`). `isPrDone` counts it as handled; it is
 * never stored as `handledAt`.
 */
export function actedAfterSeeing(pr: Pr, events: PrEvent[], viewer: Viewer, reads: ReadStamps): boolean {
  const actedAt = newestOwnActivity(pr, events, viewer);
  if (actedAt === null) {
    return false;
  }
  const people = events.filter((event) => isPersonsEvent(event, pr, viewer));
  if (people.some((event) => event.at >= actedAt)) {
    return false;
  }
  return sawEverythingBefore(events, actedAt, reads, pr, viewer);
}

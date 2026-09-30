// The tile's headline ("why here") event among the unseen quiet ones: the
// most important news wins, the newest within its class. A deploy bot that
// posted last must not lead a tile that also holds a merge without review or
// a teammate's approval. DESIGN.md "Tile faces" › Why it's here.
import { isAutomation } from './bots.ts';
import { requestsOfViewer, reviewRequestTarget } from './review-request.ts';
import type { Pr, PrEvent, Viewer } from './types.ts';

/** Most important first: asks, merged or closed without review, verdicts, comments, other people's events, automation. */
type HeadlineClass = 0 | 1 | 2 | 3 | 4 | 5;

const ASK_KINDS = ['mention', 'team_mention', 'question_to_user', 'reply_to_user'];
const VERDICT_KINDS = ['review_approved', 'review_changes_requested'];
const COMMENT_KINDS = ['comment', 'review_commented'];

function isAsk(event: PrEvent, pr: Pr, viewer: Viewer | null): boolean {
  if (ASK_KINDS.includes(event.kind)) {
    return true;
  }
  return event.kind === 'review_requested' && viewer !== null && requestsOfViewer(pr, viewer).some((item) => item.id === event.sourceId);
}

export function isAutomationEvent(event: PrEvent, pr: Pr, viewer: Viewer | null): boolean {
  return isAutomation(event, reviewRequestTarget(event, pr), viewer);
}

function headlineClass(event: PrEvent, pr: Pr, viewer: Viewer | null): HeadlineClass {
  // Merges without review are made by bots (the merge queue) and still lead: they are news for the viewer.
  if (event.kind === 'merged_without_review' || event.kind === 'closed') {
    return 1;
  }
  if (isAutomationEvent(event, pr, viewer)) {
    return 5;
  }
  if (isAsk(event, pr, viewer)) {
    return 0;
  }
  if (VERDICT_KINDS.includes(event.kind)) {
    return 2;
  }
  return COMMENT_KINDS.includes(event.kind) ? 3 : 4;
}

/** The event that leads the tile: best class first, newest within it (the later one in the list on a tie). Undefined for an empty list. */
export function pickHeadlineEvent(events: PrEvent[], pr: Pr, viewer: Viewer | null): PrEvent | undefined {
  let best: PrEvent | undefined;
  let bestClass: HeadlineClass = 5;
  for (const event of events) {
    const eventClass = headlineClass(event, pr, viewer);
    if (best === undefined || eventClass < bestClass || (eventClass === bestClass && event.at >= best.at)) {
      best = event;
      bestClass = eventClass;
    }
  }
  return best;
}

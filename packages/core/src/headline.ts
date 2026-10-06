// The tile's headline ("why here") event among the unseen quiet ones: the
// most important news wins, the newest within its class. A deploy bot that
// posted last must not lead a tile that also holds a merge without review or
// a teammate's approval. DESIGN.md "Tile faces" › Why it's here.
import { botThreadOf } from './bot-threads.ts';
import { isAutomation } from './bots.ts';
import { isCarrierReviewEvent } from './carrier-reviews.ts';
import { editMentionOf, isRoutingTeamMention } from './events.ts';
import { requestsOfViewer, reviewRequestTarget } from './review-request.ts';
import type { Pr, PrEvent, Viewer } from './types.ts';

/**
 * Most important first: asks, merged or closed without review, verdicts,
 * comments, other people's events (a reply to a bot in a review thread
 * and the empty review GitHub wraps a thread reply in among them), automation.
 */
export type HeadlineClass = 0 | 1 | 2 | 3 | 4 | 5;

const ASK_KINDS = ['mention', 'question_to_user', 'reply_to_user'];
const VERDICT_KINDS = ['review_approved', 'review_changes_requested'];
const COMMENT_KINDS = ['comment', 'review_commented', 'comment_edited'];

function isAsk(event: PrEvent, pr: Pr, viewer: Viewer | null): boolean {
  if (event.kind === 'team_mention') {
    // A routing team's mention is FYI, not an ask (DESIGN.md "Team roles").
    return viewer === null || !isRoutingTeamMention(event, pr, viewer);
  }
  if (ASK_KINDS.includes(event.kind)) {
    return true;
  }
  if (event.kind === 'comment_edited') {
    // A person's edit that now mentions the viewer or a home team is an ask; any other edit ranks with comments.
    return viewer !== null && editMentionOf(event, pr, viewer) !== null;
  }
  return event.kind === 'review_requested' && viewer !== null && requestsOfViewer(pr, viewer).some((item) => item.id === event.sourceId);
}

export function isAutomationEvent(event: PrEvent, pr: Pr, viewer: Viewer | null): boolean {
  return isAutomation(event, reviewRequestTarget(event, pr), viewer);
}

export function headlineClass(event: PrEvent, pr: Pr, viewer: Viewer | null): HeadlineClass {
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
  // "fixed" to a review bot, and the empty review GitHub wraps any thread reply in, are housekeeping:
  // they never lead over a person's comment (bot-threads.ts, carrier-reviews.ts).
  if (botThreadOf(event, pr) !== null || isCarrierReviewEvent(event, pr)) {
    return 4;
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

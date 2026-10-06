// The board diet (DESIGN.md "The board diet"): a board read leaves out every
// body no board rule reads (`isBodyReadByRules`). Every rule a board runs
// must answer the same on that shape (`boardShape`) as on the PR with every
// body, over generated boards and the event corpus. Agent prompt text and
// glance hashes are checked the same way in packages/agent. The PR pane's
// activity list is not a board rule: it shows a folded bot review's
// comments and checks bot text for mentions, so it takes a `FullPr` (the
// compiler holds it to that) and the pane reads its PR whole.
// POSTPILE_PROPERTY_RUNS=10000 pnpm test runs more boards.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { botThreadOf, carriedBotThreadReplies } from '../bot-threads.ts';
import { carriedReplies, isCarrierReview } from '../carrier-reviews.ts';
import { editMentionOf, isRoutingTeamMention } from '../events.ts';
import { makeThreadFor, singleTile } from '../fixtures.ts';
import { forWhom } from '../for-whom.ts';
import { lookCloserPingCheck } from '../glance-pings.ts';
import { headlineClass } from '../headline.ts';
import { mergeQueueState } from '../merge-queue.ts';
import { pingRule } from '../pings.ts';
import { prPaneView } from '../pr-pane.ts';
import { boardShape } from '../pr-parts.ts';
import { prStatus } from '../pr-status.ts';
import { judgedReadCheck, quietReadCheck, requestGoneReadCheck, touchedReadCheck } from '../quiet-reads.ts';
import {
  boardSpecArb,
  buildBoard,
  CORPUS,
  CORPUS_NOW,
  CORPUS_SCENARIOS,
  CORPUS_VIEWER,
  corpusEvents,
  PROPERTY_TIMEOUT_MS,
  propertyRuns,
  tileViewsOf,
  withFullPrs,
  type PropertyBoard,
} from '../testing/index.ts';
import { prFacts } from '../tile-view.ts';
import type { NotificationThread, Pr, PrEvent, Viewer } from '../types.ts';
import { whatsNew } from '../whats-new.ts';
import { whoseTurn } from '../whose-turn.ts';
import { WHY_ORDER } from '../why-here.ts';

/** What every PR-level rule says about one PR, as plain data. */
function prRuleOutputs(pr: Pr, events: PrEvent[], viewer: Viewer, thread: NotificationThread | null, now: string): unknown {
  const fresh = events.filter((event) => event.seenAt === null);
  const quietInput = thread === null ? null : { thread, pr, events, userState: null, viewer, notYours: false, prFetchedAt: now };
  return {
    status: prStatus(pr),
    queue: mergeQueueState(pr),
    facts: prFacts(pr, events, viewer),
    forWhom: WHY_ORDER.map((code) => forWhom(code, pr, viewer)),
    ping: pingRule(fresh, pr, viewer, false),
    pingSnoozed: pingRule(fresh, pr, viewer, false, true),
    perEvent: events.map((event) => ({
      edit: editMentionOf(event, pr, viewer),
      routing: isRoutingTeamMention(event, pr, viewer),
      botThread: botThreadOf(event, pr),
      headline: headlineClass(event, pr, viewer),
    })),
    reviews: pr.reviews.map((review) => ({
      carrier: isCarrierReview(review, pr),
      carried: carriedReplies(review, pr).map((comment) => comment.id),
      botThread: carriedBotThreadReplies(review, pr).map((comment) => comment.id),
    })),
    pane: prPaneView(pr),
    whatsNew: whatsNew(pr, events, viewer),
    turn: whoseTurn({ tile: singleTile(pr), prs: new Map([[pr.key, pr]]), events: new Map([[pr.key, events]]), userStates: new Map(), viewer }),
    lookCloser: lookCloserPingCheck({ pr, viewer, glance: { verdict: 'LOOK_CLOSER' }, userState: null, snoozed: false, pingedRequestId: null }),
    quiet:
      quietInput === null
        ? null
        : [quietReadCheck(quietInput), touchedReadCheck(quietInput), judgedReadCheck(quietInput), requestGoneReadCheck(quietInput)],
  };
}

/** Every tile view of the board and every PR's rule outputs. */
function boardOutputs(board: PropertyBoard): unknown {
  return {
    views: tileViewsOf(board),
    prs: [...board.prs.values()].map((pr) => prRuleOutputs(pr, board.events.get(pr.key) ?? [], board.viewer, board.threads.get(pr.key) ?? null, board.now)),
  };
}

describe('the board diet', () => {
  it('leaves every rule output of a generated board unchanged', () => {
    fc.assert(
      fc.property(boardSpecArb, (spec) => {
        const board = buildBoard(spec);
        expect(boardOutputs(board)).toEqual(boardOutputs(withFullPrs(board)));
      }),
      { numRuns: Math.min(propertyRuns(), 300) },
    );
  }, PROPERTY_TIMEOUT_MS);

  it('leaves every rule output of every corpus PR unchanged', () => {
    for (const scenario of Object.values(CORPUS_SCENARIOS)) {
      for (const entry of Object.values(CORPUS)) {
        const { pr, events } = corpusEvents(scenario.pr, entry);
        const thread = { ...makeThreadFor(pr), unread: true, updatedAt: pr.updatedAt };
        expect(prRuleOutputs(boardShape(pr), events, CORPUS_VIEWER, thread, CORPUS_NOW)).toEqual(prRuleOutputs(pr, events, CORPUS_VIEWER, thread, CORPUS_NOW));
      }
    }
  });

  it('leaves out bot bodies on the corpus, so the diet is not a no-op', () => {
    let left = 0;
    for (const scenario of Object.values(CORPUS_SCENARIOS)) {
      for (const entry of Object.values(CORPUS)) {
        const board = boardShape(corpusEvents(scenario.pr, entry).pr);
        left += board.comments.filter((comment) => comment.body === null).length + board.reviews.filter((review) => review.body === null).length;
      }
    }
    expect(left).toBeGreaterThan(0);
  });
});

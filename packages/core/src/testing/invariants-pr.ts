// PR-level invariants: tier and whose move, snoozes, quiet reads and pings
// (DESIGN.md "Rules layer: one home per fact", "Handled quietly", "Live poll
// and Mac pings", "Look closer pings").
import { isAutomation } from '../bots.ts';
import { lookCloserEvent, lookCloserPingCheck, routedTeamRequest } from '../glance-pings.ts';
import { isOwnEvent, lastTouch, READING_TOUCH_KINDS } from '../last-touch.ts';
import { pingRule } from '../pings.ts';
import { quietReadCheck, touchedReadCheck } from '../quiet-reads.ts';
import { reviewedHead, reviewRequestTarget, teamRequestHold } from '../review-request.ts';
import { snoozePhase } from '../snooze.ts';
import type { Pr, PrEvent, PrKey } from '../types.ts';
import type { PrSummary, TileView } from '../views.ts';
import type { BoardSpec } from './board-spec.ts';
import { buildBoard, tileViewsOf, type PropertyBoard } from './build-board.ts';
import { describeTurn, ensure, eventsOf, isNews, prOf, trackedRows, type Invariant } from './invariant.ts';

/**
 * Why a tracked open PR can sit in To review while its move is not Review,
 * on purpose (DESIGN "Look closer pings", team coverage, "Whose turn"):
 * a routed team request the glance calls not yours, a routed request
 * waiting on someone else's change request, a team request a teammate took,
 * or an ask (a team mention) that comes first.
 */
export function toReviewException(board: PropertyBoard, pr: Pr, row: PrSummary): string | null {
  const notYours = board.notYours.has(pr.key);
  if (row.facts.reviewRequest === 'team' && notYours) {
    return 'routed, not yours';
  }
  if (teamRequestHold(pr, board.viewer, notYours)?.kind === 'changes') {
    return 'routed, changes held';
  }
  if (row.facts.reviewRequest === 'team_taken') {
    return 'team request taken';
  }
  if (row.turn.kind === 'you' && row.turn.move === 'reply') {
    return 'an ask comes first';
  }
  return null;
}

export const toReviewMatchesReviewMove: Invariant = {
  name: 'tier To review and whose move Review agree, except the named cases',
  check(board, views) {
    for (const row of views.flatMap(trackedRows)) {
      const review = row.turn.kind === 'you' && row.turn.move === 'review';
      // A request while your changes request stands is a Re-review, under
      // Changes you requested (decided 2026-09-30), so Review is always To review.
      if (review) {
        ensure(row.tier === 'to_review', `${row.key}: move Review, tier ${row.tier}`);
      }
      if (row.tier === 'to_review' && !review) {
        ensure(toReviewException(board, prOf(board, row.key), row) !== null, `${row.key}: tier To review, ${describeTurn(row.turn)}`);
      }
    }
  },
};

function snoozeContext(board: PropertyBoard, key: PrKey, events: PrEvent[] = eventsOf(board, key)) {
  return { pr: prOf(board, key), events, now: board.now, viewer: board.viewer };
}

/**
 * News that wakes a snooze (2026-09-30): loud from a human, or automation
 * the agent raised to loud. A bot event at its rule's loudness never does.
 */
function wakesSnooze(event: PrEvent, pr: Pr, board: PropertyBoard): boolean {
  if (!isNews(event)) {
    return false;
  }
  return !isAutomation(event, reviewRequestTarget(event, pr), board.viewer) || event.override?.loudness === 'loud';
}

/** Human or raised news after the start breaks a snooze; every snooze on a finished PR is over; the app's Look closer event never wakes one. */
export const snoozeLifecycle: Invariant = {
  name: 'snoozes: human or agent-raised news breaks, a finished PR ends every snooze, Look closer never wakes',
  check(board) {
    for (const [key, snooze] of board.snoozes) {
      const pr = prOf(board, key);
      const events = eventsOf(board, key);
      const phase = snoozePhase(snooze, snoozeContext(board, key));
      ensure(pr.state === 'OPEN' || phase !== 'active', `${key}: ${snooze.condition.kind} snooze still active on a ${pr.state} PR`);
      const waking = events.filter((event) => event.at > snooze.since && wakesSnooze(event, pr, board));
      ensure(waking.length === 0 || phase === 'broken', `${key}: human or raised news after the snooze, phase ${phase}`);
      if (phase === 'broken') {
        ensure(waking.length > 0, `${key}: snooze broken without human or raised news`);
      }
      const withoutLookCloser = events.filter((event) => event.kind !== 'look_closer');
      const freshPing = lookCloserEvent(pr, 'acme/team-platform', 'fresh-request', board.now);
      for (const variant of [withoutLookCloser, [...events, freshPing]]) {
        ensure(snoozePhase(snooze, snoozeContext(board, key, variant)) === phase, `${key}: a Look closer event moves the snooze from ${phase}`);
      }
    }
  },
};

function holdingViews(views: TileView[], key: PrKey): TileView[] {
  return views.filter((view) => view.tile.members.some((member) => member.prKey === key));
}

/**
 * The quiet mark-reads never hide an ask: the bot-only rule never marks
 * while a person's loud news is unseen, the acted-after rule only when the
 * viewer reviewed or commented after every such news, and neither trusts a
 * truncated snapshot.
 */
export const quietReadsNeverHideAsks: Invariant = {
  name: 'quiet reads never hide unseen human news the viewer did not act after, nor trust a truncated snapshot',
  check(board, views) {
    for (const [key, thread] of board.threads) {
      const holding = holdingViews(views, key);
      if (holding.length === 0) {
        continue;
      }
      const pr = prOf(board, key);
      const events = eventsOf(board, key);
      const input = {
        thread,
        pr,
        events,
        userState: board.userStates.get(key) ?? null,
        viewer: board.viewer,
        tileUnread: holding.some((view) => view.state.kind === 'unread'),
        notYours: board.notYours.has(key),
        prFetchedAt: board.prFetchedAt.get(key) ?? null,
        now: board.now,
      };
      const quiet = quietReadCheck(input);
      const touched = touchedReadCheck(input);
      const humanNews = events.filter((event) => isNews(event) && !isOwnEvent(event, board.viewer) && !isAutomation(event, reviewRequestTarget(event, pr), board.viewer));
      if (quiet.kind === 'mark') {
        ensure(!pr.truncated, `${key}: bot-only quiet read on a truncated snapshot`);
        ensure(humanNews.length === 0, `${key}: bot-only quiet read with human news ${humanNews.map((event) => event.id).join(', ')}`);
      }
      if (touched.kind === 'mark') {
        ensure(!pr.truncated, `${key}: acted-after quiet read on a truncated snapshot`);
        const touch = lastTouch(pr, events, board.viewer, { kinds: READING_TOUCH_KINDS });
        const after = humanNews.filter((event) => touch === null || event.at >= touch.at);
        ensure(after.length === 0, `${key}: acted-after quiet read with human news after the touch: ${after.map((event) => event.id).join(', ')}`);
      }
    }
  },
};

/**
 * The poll's rules on a PR's new events, told whether its tile is snoozed
 * like the ping decider tells them: a ping is about a loud unseen event, and
 * never comes from a snoozed or done tile. New events are the unseen ones
 * after the PR's snooze started: the poll brings in what happened since, and
 * news from before the snooze was pinged before it.
 */
export const pingsOnlyForLiveNews: Invariant = {
  name: 'a ping is about unseen loud news and never comes from a snoozed or done tile',
  check(board, views) {
    for (const [key, thread] of board.threads) {
      const holding = holdingViews(views, key);
      if (!thread.unread || holding.length === 0) {
        continue;
      }
      const pr = prOf(board, key);
      const since = board.snoozes.get(key)?.since ?? '';
      const fresh = eventsOf(board, key).filter((event) => event.seenAt === null && event.at > since);
      const snoozed = holding.some((view) => view.state.kind === 'snoozed');
      const rule = pingRule(fresh, pr, board.viewer, false, snoozed);
      if (rule.class !== 'addressed') {
        continue;
      }
      ensure(rule.event !== null && fresh.includes(rule.event) && isNews(rule.event), `${key}: ping about ${rule.event?.id ?? 'nothing'}, not unseen loud news`);
      for (const view of holding) {
        ensure(view.state.kind !== 'snoozed' && view.state.kind !== 'done', `${key}: ping for ${rule.event!.id} from a ${view.state.kind} tile`);
      }
    }
  },
};

/** The Look closer ping never fires on a snoozed tile, and only for a pending routed request the viewer has not reviewed. */
export const lookCloserPingRules: Invariant = {
  name: 'a Look closer ping needs a pending routed request, no review of the head, no snooze',
  check(board) {
    for (const [key, pr] of board.prs) {
      const userState = board.userStates.get(key) ?? null;
      const input = { pr, viewer: board.viewer, glance: { verdict: 'LOOK_CLOSER' as const }, userState, pingedRequestId: null };
      ensure(lookCloserPingCheck({ ...input, snoozed: true }).kind === 'skip', `${key}: Look closer pings on a snoozed tile`);
      if (lookCloserPingCheck({ ...input, snoozed: false }).kind === 'ping') {
        ensure(routedTeamRequest(pr, board.viewer) !== null && !reviewedHead(pr, board.viewer, userState), `${key}: Look closer pings without a pending unreviewed routed request`);
      }
    }
  },
};

/** The same board with every review request aimed at the viewer or their team made by a person instead of a bot (PRs by the viewer left alone: their own request is their own activity). */
export function withHumanRequests(spec: BoardSpec): BoardSpec {
  return {
    ...spec,
    groups: spec.groups.map((group) => ({
      ...group,
      prs: group.prs.map((pr) =>
        pr.author === 'viewer'
          ? pr
          : { ...pr, steps: pr.steps.map((step) => (step.kind === 'request' && (step.target === 'viewer' || step.target === 'team') ? { ...step, byBot: false } : step)) },
      ),
    })),
  };
}

function ruleFacts(board: PropertyBoard, views: TileView[]) {
  return {
    tiles: views.map((view) => ({ id: view.tile.id, state: view.state.kind, turn: view.turn.kind, members: view.tile.members.map((member) => member.provenance.kind) })),
    prs: views.flatMap((view) => view.prs).map((row) => ({ key: row.key, done: row.done, tier: row.tier, turn: row.turn.kind, unseen: row.unseenLoudEvents })),
    pings: [...board.threads.keys()].filter((key) => board.prs.has(key)).map((key) => {
      const fresh = eventsOf(board, key).filter((event) => event.seenAt === null);
      const rule = pingRule(fresh, prOf(board, key), board.viewer, false);
      return { key, class: rule.class, loudness: rule.loudness };
    }),
    snoozes: [...board.snoozes].map(([key, snooze]) => snoozePhase(snooze, snoozeContext(board, key))),
  };
}

/** A review request counts by whom it asks, not by who clicked it (2026-09-29): a bot's request for the viewer works like a person's. */
export const botRequestWorksLikeHuman: Invariant = {
  name: "a bot's review request for the viewer or their team works like a person's",
  check(board, views) {
    const human = buildBoard(withHumanRequests(board.spec));
    const expected = JSON.stringify(ruleFacts(human, tileViewsOf(human)));
    ensure(JSON.stringify(ruleFacts(board, views)) === expected, 'tile states, turns, tiers, pings or snoozes change when a person makes the request');
  },
};

export const PR_INVARIANTS: readonly Invariant[] = [
  toReviewMatchesReviewMove,
  snoozeLifecycle,
  quietReadsNeverHideAsks,
  pingsOnlyForLiveNews,
  lookCloserPingRules,
  botRequestWorksLikeHuman,
];

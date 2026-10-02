// PR-level invariants: tier and whose move, snoozes, quiet reads and pings
// (DESIGN.md "Rules layer: one home per fact", "Handled quietly", "GitHub
// unread is PostPile unread", "Live poll and Mac pings", "Look closer pings").
import { lookCloserEvent } from '../glance-pings.ts';
import { pingRule } from '../pings.ts';
import { judgedReadCheck, quietReadCheck, touchedReadCheck } from '../quiet-reads.ts';
import { snoozePhase } from '../snooze.ts';
import type { NotificationThread, Pr, PrEvent, PrKey } from '../types.ts';
import type { PrSummary, TileView } from '../views.ts';
import type { BoardSpec, RequestTarget } from './board-spec.ts';
import { buildBoard, tileViewsOf, type PropertyBoard } from './build-board.ts';
import { describeTurn, ensure, eventsOf, isNews, prOf, trackedRows, type Invariant } from './invariant.ts';
import { isViewerLogin, newestTouch, READING_TOUCHES, routedRequestWaits, specMergeQueue, specPrIcon } from './spec-facts.ts';
import { cutSnapshotHoldsSince, expectedSnoozePhase, isAskEvent, isAutomationEvent, lastLooked } from './spec-rules.ts';

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
  if (routedRequestWaits(pr, board.viewer, notYours) === 'changes') {
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
 * A snooze's phase is the spec's (spec-rules.ts `expectedSnoozePhase`):
 * broken by unseen loud news from a person or automation the agent raised
 * (2026-09-30), over once the PR is merged or closed (every kind,
 * 2026-09-30) or its condition is met. The app's Look closer event never
 * moves it.
 */
export const snoozeLifecycle: Invariant = {
  name: 'snoozes: human or agent-raised news breaks, a finished PR ends every snooze, Look closer never wakes',
  check(board) {
    for (const [key, snooze] of board.snoozes) {
      const pr = prOf(board, key);
      const events = eventsOf(board, key);
      const phase = snoozePhase(snooze, snoozeContext(board, key));
      const expected = expectedSnoozePhase({ pr, events, viewer: board.viewer, snooze, now: board.now });
      ensure(phase === expected, `${key}: ${snooze.condition.kind} snooze ${phase}, expected ${expected}`);
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

/** A quiet read's input for one thread of the board. */
function quietInput(board: PropertyBoard, key: PrKey, thread: NotificationThread) {
  return {
    thread,
    pr: prOf(board, key),
    events: eventsOf(board, key),
    userState: board.userStates.get(key) ?? null,
    viewer: board.viewer,
    notYours: board.notYours.has(key),
    prFetchedAt: board.prFetchedAt.get(key) ?? null,
  };
}

/**
 * The quiet mark-reads never hide an ask: the bot-only rule never marks
 * while a person's loud news is unseen, the acted-after rule only when the
 * viewer reviewed or commented after every such news, the judged rule never
 * while a person's activity since the viewer last looked is loud or not
 * judged by the agent, and none trusts a snapshot cut off inside the unread interval.
 */
export const quietReadsNeverHideAsks: Invariant = {
  name: 'quiet reads never hide unseen human news the viewer did not act after or the agent did not judge, nor trust a snapshot cut off inside the unread interval',
  check(board, views) {
    for (const [key, thread] of board.threads) {
      if (holdingViews(views, key).length === 0) {
        continue;
      }
      const pr = prOf(board, key);
      const events = eventsOf(board, key);
      const input = quietInput(board, key, thread);
      const quiet = quietReadCheck(input);
      const touched = touchedReadCheck(input);
      const judged = judgedReadCheck(input);
      const humanNews = events.filter((event) => isNews(event) && !isViewerLogin(board.viewer, event.actor) && !isAutomationEvent(pr, board.viewer, event));
      if (quiet.kind === 'mark') {
        ensure(!pr.truncated || cutSnapshotHoldsSince(pr, thread.lastReadAt!), `${key}: bot-only quiet read on a snapshot cut off after the read`);
        ensure(humanNews.length === 0, `${key}: bot-only quiet read with human news ${humanNews.map((event) => event.id).join(', ')}`);
      }
      if (touched.kind === 'mark') {
        const touch = newestTouch(pr, board.viewer, READING_TOUCHES);
        ensure(!pr.truncated || cutSnapshotHoldsSince(pr, touch!.at), `${key}: acted-after quiet read on a snapshot cut off after the touch`);
        const after = humanNews.filter((event) => touch === null || event.at >= touch.at);
        ensure(after.length === 0, `${key}: acted-after quiet read with human news after the touch: ${after.map((event) => event.id).join(', ')}`);
      }
      if (judged.kind === 'mark') {
        ensure(!pr.truncated || cutSnapshotHoldsSince(pr, lastLooked(thread, pr, board.viewer)!), `${key}: judged quiet read on a snapshot cut off after the last look`);
        ensure(humanNews.length === 0, `${key}: judged quiet read with human news ${humanNews.map((event) => event.id).join(', ')}`);
        const since = lastLooked(thread, pr, board.viewer)!;
        const unjudged = events.filter(
          (event) => event.at > since && !isViewerLogin(board.viewer, event.actor) && !isAutomationEvent(pr, board.viewer, event) && (event.override === null || event.override.loudness === 'loud'),
        );
        ensure(unjudged.length === 0, `${key}: judged quiet read with activity the agent did not judge quiet: ${unjudged.map((event) => event.id).join(', ')}`);
      }
    }
  },
};

/**
 * Asks never auto-clear (DESIGN "GitHub unread is PostPile unread"): no
 * quiet mark-read, whatever its reason, marks a thread while an ask of the
 * viewer on it is unseen, nor while one came after the viewer last looked
 * (a review request of them or their team, a mention, a team mention, a
 * question or reply to them, an unseen merge without their review), also
 * after the agent lowered it.
 */
export const asksNeverAutoClear: Invariant = {
  name: 'no quiet read marks a thread while an ask of the viewer on it is unseen or came since they last looked',
  check(board, views) {
    for (const [key, thread] of board.threads) {
      if (holdingViews(views, key).length === 0) {
        continue;
      }
      const pr = prOf(board, key);
      const input = quietInput(board, key, thread);
      const reasons = [
        quietReadCheck(input).kind === 'mark' ? 'bots' : null,
        touchedReadCheck(input).kind === 'mark' ? 'acted after' : null,
        judgedReadCheck(input).kind === 'mark' ? 'judged' : null,
      ].filter((reason) => reason !== null);
      if (reasons.length === 0) {
        continue;
      }
      const since = lastLooked(thread, pr, board.viewer);
      const asks = eventsOf(board, key).filter(
        (event) => !isViewerLogin(board.viewer, event.actor) && isAskEvent(pr, board.viewer, event) && (event.seenAt === null || (since !== null && event.at > since)),
      );
      ensure(asks.length === 0, `${key}: quiet read (${reasons.join(', ')}) with asks ${asks.map((event) => event.id).join(', ')}`);
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

/**
 * The same board with every review request aimed at the viewer or their
 * teams (approvers too when it is one of theirs) made by a person instead
 * of a bot (PRs by the viewer left alone: their own request is their own
 * activity).
 */
export function withHumanRequests(spec: BoardSpec): BoardSpec {
  const targets: RequestTarget[] = spec.teams === 'one_home' ? ['viewer', 'team'] : ['viewer', 'team', 'routing_team'];
  return {
    ...spec,
    groups: spec.groups.map((group) => ({
      ...group,
      prs: group.prs.map((pr) =>
        pr.author === 'viewer'
          ? pr
          : { ...pr, steps: pr.steps.map((step) => (step.kind === 'request' && targets.includes(step.target) ? { ...step, byBot: false } : step)) },
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

/**
 * Every PR row's state icon and merge queue step are the spec's (DESIGN
 * "Merge queue"): an open PR in a queue shows the queue icon, failed in
 * Trunk's queue the red one, and a merged PR shows merged again.
 */
export const prIconMatchesTheSpec: Invariant = {
  name: "each PR row's state icon and merge queue step are the spec's",
  check(board, views) {
    for (const row of views.flatMap((view) => view.prs)) {
      const pr = prOf(board, row.key);
      const icon = specPrIcon(pr);
      ensure(row.status.icon === icon, `${row.key}: icon ${row.status.icon}, expected ${icon}`);
      const queue = pr.isDraft ? null : specMergeQueue(pr);
      const got = row.status.mergeQueue === null ? 'none' : `${row.status.mergeQueue.state} since ${row.status.mergeQueue.since}`;
      const want = queue === null ? 'none' : `${queue.state} since ${queue.at}`;
      ensure(got === want, `${row.key}: merge queue ${got}, expected ${want}`);
    }
  },
};

export const PR_INVARIANTS: readonly Invariant[] = [
  prIconMatchesTheSpec,
  toReviewMatchesReviewMove,
  snoozeLifecycle,
  quietReadsNeverHideAsks,
  asksNeverAutoClear,
  pingsOnlyForLiveNews,
  botRequestWorksLikeHuman,
];

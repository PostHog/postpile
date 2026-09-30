// Topic-level invariants: the sidebar row's counts come from its tiles, and a
// finished topic can retire (DESIGN.md "Queue sections", "Snoozes belong to
// PRs", engine `RetireGate`). Plus determinism over the whole board.
import { topicQueues, emptyTierCounts, pingedPrKeys, ownerRelation } from '../topic-queues.ts';
import { topicMove, topicUrgency } from '../topic-urgency.ts';
import { prTier } from '../pr-tier.ts';
import type { PrEvent } from '../types.ts';
import type { TileView } from '../views.ts';
import { isReReviewMove, prWhoseTurn, type YourMove } from '../whose-turn.ts';
import { tileViewsOf, type PropertyBoard } from './build-board.ts';
import { ensure, eventsOf, isNews, isTrackedHere, prOf, type Invariant } from './invariant.ts';
import { expectedTurn, isUnseenMergeWithoutViewer } from './spec-rules.ts';

/** Unseen loud news on a PR of the tile that is not found. */
function tileHasNews(board: PropertyBoard, view: TileView): boolean {
  return view.tile.members.some((member) => member.provenance.kind !== 'found' && eventsOf(board, member.prKey).some(isNews));
}

/** Most urgent first, like the sidebar sections: spelled out here, not read from `YOUR_MOVE_ORDER`. */
const MOVE_ORDER: readonly YourMove[] = ['reply', 're_review', 'review', 'address_changes', 'merge'];

/** The row's urgency as the read models build it, from the tiles. */
function urgencyOf(views: TileView[]) {
  return topicUrgency(
    views.map((view) => ({
      state: view.state.kind,
      unreadOnGitHub: view.state.unreadOnGitHub,
      loud: view.state.loud,
      prStates: view.prs.map((row) => row.state),
      move: topicMove(view.turn),
      quiet: false,
    })),
  );
}

/**
 * Unread count, your moves and "needs you" say what the tiles say. The count
 * is every tile with a thread unread on GitHub, snoozed ones too; only
 * unread tiles with loud news light the topic up (loudness keeps its job).
 */
export const topicCountsMatchTiles: Invariant = {
  name: "a topic's unread count, your moves and needs-you match its tiles",
  check(board, views) {
    const urgency = urgencyOf(views);
    const withUnreadThread = views.filter((view) => view.tile.members.some((member) => board.threads.get(member.prKey)?.unread === true));
    ensure(urgency.unreadTiles === withUnreadThread.length, `unread tiles ${urgency.unreadTiles}, tiles with an unread thread ${withUnreadThread.length}`);
    const unread = views.filter((view) => view.state.kind === 'unread');
    const loudUnread = unread.filter((view) => tileHasNews(board, view));
    const live = views.filter((view) => view.state.kind === 'unread' || view.state.kind === 'open');
    const moves = live.flatMap((view) => (view.turn.kind === 'you' ? [view.turn.move] : []));
    ensure(urgency.yourMoves.length === moves.length, `your moves ${urgency.yourMoves.length}, live tiles your move ${moves.length}`);
    const order = urgency.yourMoves.map((move) => MOVE_ORDER.indexOf(move.move));
    ensure(order.every((rank, index) => index === 0 || order[index - 1]! <= rank), 'your moves out of order');
    const urgentUnread = loudUnread.some((view) => view.prs.some((row) => row.state === 'OPEN'));
    const urgentMove = moves.some((move) => move !== 'merge');
    ensure(urgency.needsYou === (urgentUnread || urgentMove), `needs you ${urgency.needsYou}, open unread ${urgentUnread}, move ${urgentMove}`);
  },
};

/**
 * The queue counts count each tracked PR once, by the tier its rows show;
 * pulled-in layers never count. Changes you requested PRs whose spec move
 * is a re-review (addressed, or asked again) count as addressed, so the
 * section's order follows the move (2026-09-30).
 */
export const queueCountsMatchRows: Invariant = {
  name: "a topic's queue counts match its tracked rows, re-reviews counted as addressed",
  check(board, views) {
    const pinged = pingedPrKeys(views.map((view) => view.tile));
    const keys = [...new Set(views.flatMap((view) => view.tile.members.map((member) => member.prKey)))];
    const queues = topicQueues(
      keys.map((key) => {
        const pr = prOf(board, key);
        const userState = board.userStates.get(key) ?? null;
        const turn = prWhoseTurn({ pr, events: eventsOf(board, key), userState, viewer: board.viewer, notYours: board.notYours.has(key) });
        return {
          tier: prTier({ pr, events: eventsOf(board, key), viewer: board.viewer, userState: board.userStates.get(key) ?? null, reason: board.threads.get(key)?.reason ?? null }),
          author: ownerRelation(pr, board.viewer),
          state: pr.state,
          pulledIn: !pinged.has(key),
          quiet: false,
          changesAddressed: isReReviewMove(turn),
        };
      }),
    );
    const expected = emptyTierCounts();
    let reReviews = 0;
    const counted = new Set<string>();
    for (const row of views.flatMap((view) => view.prs)) {
      if (isTrackedHere(row.provenance) && !counted.has(row.key)) {
        counted.add(row.key);
        expected[row.tier] += 1;
        const spec = expectedTurn({ pr: prOf(board, row.key), events: eventsOf(board, row.key), viewer: board.viewer, userState: board.userStates.get(row.key) ?? null, notYours: board.notYours.has(row.key) });
        if (row.tier === 'changes_requested' && spec.kind === 'you' && spec.move === 're_review') {
          reReviews += 1;
        }
      }
    }
    ensure(JSON.stringify(queues.tiers) === JSON.stringify(expected), `queue counts ${JSON.stringify(queues.tiers)}, rows ${JSON.stringify(expected)}`);
    ensure(queues.changesAddressed === reReviews, `addressed ${queues.changesAddressed}, spec re-reviews under Changes you requested ${reReviews}`);
  },
};

/**
 * A finished topic can retire: every PR merged or closed (which ends every
 * snooze), no loud news unseen, no unseen merge without review and every
 * thread read on GitHub leaves every tile done, and then nothing in the row
 * needs you. A thread unread on GitHub keeps its tile, and so its topic,
 * from being done (the engine's retire gate needs every tile done and every
 * thread read).
 */
export const finishedTopicRetires: Invariant = {
  name: 'a finished topic with nothing unseen and every thread read has every tile done and needs nothing',
  check(board, views) {
    const keys = [...new Set(views.flatMap((view) => view.tile.members.map((member) => member.prKey)))];
    const allOver = keys.length > 0 && keys.every((key) => prOf(board, key).state !== 'OPEN');
    if (allOver) {
      ensure(views.every((view) => view.state.kind !== 'snoozed'), 'a snooze holds a finished tile');
      const nothingUnseen = views.every((view) =>
        view.tile.members.every((member) => {
            const events = eventsOf(board, member.prKey);
            const news = member.provenance.kind !== 'found' && events.some(isNews);
            const merge = isTrackedHere(member.provenance) && !board.notYours.has(member.prKey) && events.some(isUnseenMergeWithoutViewer);
            const unreadThread = board.threads.get(member.prKey)?.unread === true;
            return !news && !merge && !unreadThread;
          }),
      );
      if (nothingUnseen) {
        ensure(views.every((view) => view.state.kind === 'done'), `finished topic with nothing unseen has tiles ${views.map((view) => view.state.kind).join(', ')}`);
      }
    }
    if (views.length > 0 && views.every((view) => view.state.kind === 'done')) {
      const urgency = urgencyOf(views);
      ensure(!urgency.needsYou && urgency.unreadTiles === 0 && urgency.yourMoves.length === 0, 'every tile done, but the topic still needs you');
    }
    const unreadThread = views.some((view) => view.tile.members.some((member) => board.threads.get(member.prKey)?.unread === true));
    if (unreadThread) {
      ensure(views.some((view) => view.state.kind === 'unread' || view.state.kind === 'snoozed'), 'a thread is unread on GitHub, but no tile shows it');
    }
  },
};

/** The same board built twice gives the same tiles, rows and buttons. */
export const sameBoardSameViews: Invariant = {
  name: 'the same board twice gives deep-equal views',
  check(board, views) {
    ensure(JSON.stringify(tileViewsOf(board)) === JSON.stringify(views), 'views differ between two builds');
  },
};

/**
 * Events in another order: newest first instead of oldest first. Events on
 * the same instant keep their store order (time, then id): rules break such
 * ties by that order on purpose, the store always lists events that way.
 */
export function newestFirstKeepingTies(events: PrEvent[]): PrEvent[] {
  const byTime = new Map<string, PrEvent[]>();
  for (const event of events) {
    byTime.set(event.at, [...(byTime.get(event.at) ?? []), event]);
  }
  return [...byTime.keys()].sort().reverse().flatMap((time) => byTime.get(time)!);
}

/** The order events arrive in does not matter: each PR's events newest first give the same views. */
export const eventOrderDoesNotMatter: Invariant = {
  name: 'event order does not change any view',
  check(board, views) {
    const reordered = new Map([...board.events].map(([key, events]) => [key, newestFirstKeepingTies(events)]));
    const again = tileViewsOf({ ...board, events: reordered });
    ensure(JSON.stringify(again) === JSON.stringify(views), 'views change when events come in another order');
  },
};

export const TOPIC_INVARIANTS: readonly Invariant[] = [topicCountsMatchTiles, queueCountsMatchRows, finishedTopicRetires, sameBoardSameViews, eventOrderDoesNotMatter];


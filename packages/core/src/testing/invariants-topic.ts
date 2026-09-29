// Topic-level invariants: the sidebar row's counts come from its tiles, and a
// finished topic can retire (DESIGN.md "Queue sections", "Snoozes belong to
// PRs", engine `RetireGate`). Plus determinism over the whole board.
import { topicQueues, emptyTierCounts, pingedPrKeys, personRelation } from '../topic-queues.ts';
import { topicMove, topicUrgency } from '../topic-urgency.ts';
import { YOUR_MOVE_ORDER } from '../whose-turn.ts';
import { isUnseenMergeWithoutReview } from '../loudness.ts';
import { prTier } from '../pr-tier.ts';
import { changesAnswered } from '../changes-answered.ts';
import { isTracked } from '../provenance.ts';
import type { PrEvent } from '../types.ts';
import type { TileView } from '../views.ts';
import { tileViewsOf } from './build-board.ts';
import { ensure, eventsOf, isNews, prOf, type Invariant } from './invariant.ts';

/** The row's urgency as the read models build it, from the tiles. */
function urgencyOf(views: TileView[]) {
  return topicUrgency(
    views.map((view) => ({
      state: view.state.kind,
      prStates: view.prs.map((row) => row.state),
      move: topicMove(view.turn),
      quiet: false,
    })),
  );
}

/** Unread count, your moves and "needs you" say what the tiles say. */
export const topicCountsMatchTiles: Invariant = {
  name: "a topic's unread count, your moves and needs-you match its tiles",
  check(_board, views) {
    const urgency = urgencyOf(views);
    const unread = views.filter((view) => view.state.kind === 'unread');
    ensure(urgency.unreadTiles === unread.length, `unread tiles ${urgency.unreadTiles}, tiles unread ${unread.length}`);
    const live = views.filter((view) => view.state.kind === 'unread' || view.state.kind === 'open');
    const moves = live.flatMap((view) => (view.turn.kind === 'you' ? [view.turn.move] : []));
    ensure(urgency.yourMoves.length === moves.length, `your moves ${urgency.yourMoves.length}, live tiles your move ${moves.length}`);
    const order = urgency.yourMoves.map((move) => YOUR_MOVE_ORDER.indexOf(move.move));
    ensure(order.every((rank, index) => index === 0 || order[index - 1]! <= rank), 'your moves out of order');
    const urgentUnread = unread.some((view) => view.prs.some((row) => row.state === 'OPEN'));
    const urgentMove = moves.some((move) => move !== 'merge');
    ensure(urgency.needsYou === (urgentUnread || urgentMove), `needs you ${urgency.needsYou}, open unread ${urgentUnread}, move ${urgentMove}`);
  },
};

/** The queue counts count each tracked PR once, by the tier its rows show; pulled-in layers never count. */
export const queueCountsMatchRows: Invariant = {
  name: "a topic's queue counts match its tracked rows",
  check(board, views) {
    const pinged = pingedPrKeys(views.map((view) => view.tile));
    const keys = [...new Set(views.flatMap((view) => view.tile.members.map((member) => member.prKey)))];
    const queues = topicQueues(
      keys.map((key) => {
        const pr = prOf(board, key);
        return {
          tier: prTier({ pr, events: eventsOf(board, key), viewer: board.viewer, userState: board.userStates.get(key) ?? null, reason: board.threads.get(key)?.reason ?? null }),
          author: personRelation(pr.author, board.viewer),
          state: pr.state,
          pulledIn: !pinged.has(key),
          quiet: false,
          changesAddressed: changesAnswered(pr, board.viewer) !== null,
        };
      }),
    );
    const expected = emptyTierCounts();
    const counted = new Set<string>();
    for (const row of views.flatMap((view) => view.prs)) {
      if (isTracked(row.provenance) && !counted.has(row.key)) {
        counted.add(row.key);
        expected[row.tier] += 1;
      }
    }
    ensure(JSON.stringify(queues.tiers) === JSON.stringify(expected), `queue counts ${JSON.stringify(queues.tiers)}, rows ${JSON.stringify(expected)}`);
  },
};

/**
 * A finished topic can retire: every PR merged or closed, no loud news
 * unseen, no unseen merge without review, and no snooze that still holds
 * (a push or CI snooze never holds a finished PR) leaves every tile done,
 * and then nothing in the row needs you.
 */
export const finishedTopicRetires: Invariant = {
  name: 'a finished topic with nothing unseen has every tile done and needs nothing',
  check(board, views) {
    const keys = [...new Set(views.flatMap((view) => view.tile.members.map((member) => member.prKey)))];
    const allOver = keys.length > 0 && keys.every((key) => prOf(board, key).state !== 'OPEN');
    if (allOver) {
      const onlyCodeSnoozes = [...board.snoozes.values()].every((snooze) => snooze.condition.kind === 'new_push' || snooze.condition.kind === 'ci_green');
      if (onlyCodeSnoozes) {
        ensure(views.every((view) => view.state.kind !== 'snoozed'), 'a push or CI snooze holds a finished tile');
      }
      const nothingUnseen = views.every(
        (view) =>
          view.state.kind !== 'snoozed' &&
          view.tile.members.every((member) => {
            const events = eventsOf(board, member.prKey);
            const news = member.provenance.kind !== 'found' && events.some(isNews);
            const merge = isTracked(member.provenance) && !board.notYours.has(member.prKey) && events.some(isUnseenMergeWithoutReview);
            return !news && !merge;
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


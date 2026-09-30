// What the screen shows, checked against the spec (DESIGN.md "Groups inside
// a topic", 2026-09-30): each tile's group, the unread counts, the NEW pill
// and the group order. The expected answers are restated from the board
// (threads, events, snoozes, reads), never read from `tileGroup`,
// `tileNewBadge` or the tile state under test.
import { groupTiles } from '../tile-groups.ts';
import { topicMove, topicUrgency } from '../topic-urgency.ts';
import type { TileView } from '../views.ts';
import type { PropertyBoard } from './build-board.ts';
import { ensure, eventsOf, prOf, trackedMembers, type Invariant } from './invariant.ts';
import { isSnoozedByRule, loudWithoutThreadKeys, prDone, tileNews, unreadThreadKeys } from './invariants-tile.ts';
import { effectiveLoudnessOf, isAutomationEvent } from './spec-rules.ts';

/** The groups in screen order, spelled out here (not `TILE_GROUP_ORDER`). */
const GROUP_ORDER = ['unread', 'open', 'dealt_with'] as const;

type ExpectedGroup = (typeof GROUP_ORDER)[number];

/**
 * Unread by "GitHub unread is PostPile unread": a thread of the tile is
 * unread on GitHub (snoozed or not), or, when not snoozed, a pulled-in layer
 * has loud news or a Look closer event is unseen.
 */
function isUnreadBySpec(board: PropertyBoard, view: TileView): boolean {
  if (unreadThreadKeys(board, view).length > 0) {
    return true;
  }
  return !isSnoozedByRule(board, view) && loudWithoutThreadKeys(board, view).length > 0;
}

/** Done by the spec: not snoozed, not unread, no loud news, every tracked PR done. */
function isDoneBySpec(board: PropertyBoard, view: TileView): boolean {
  if (isSnoozedByRule(board, view) || isUnreadBySpec(board, view) || tileNews(board, view).length > 0) {
    return false;
  }
  return trackedMembers(view).every((member) => prDone(board, member.prKey));
}

function expectedGroup(board: PropertyBoard, view: TileView): ExpectedGroup {
  if (isUnreadBySpec(board, view)) {
    return 'unread';
  }
  return isDoneBySpec(board, view) ? 'dealt_with' : 'open';
}

/** Every tile sits in exactly one group, the one the spec gives it, and the grouping loses or repeats none. */
export const everyTileInOneGroup: Invariant = {
  name: 'every tile is in exactly one group: Unread when unread, Dealt with when done, else Open',
  check(board, views) {
    for (const view of views) {
      const expected = expectedGroup(board, view);
      ensure(view.group === expected, `${view.tile.id}: group ${view.group}, expected ${expected} (state ${view.state.kind})`);
    }
    const grouped = groupTiles(views).flatMap((entry) => entry.tiles.map((view) => `${entry.group}:${view.tile.id}`));
    const expected = views.map((view) => `${view.group}:${view.tile.id}`);
    ensure(JSON.stringify(grouped.toSorted()) === JSON.stringify(expected.toSorted()), `grouped ${grouped.join(', ')}, tiles ${expected.join(', ')}`);
  },
};

/** A tile is in Unread exactly when it shows an unread dot: the group and the dots never disagree. */
export const unreadGroupIffDotted: Invariant = {
  name: 'a tile is in the Unread group exactly when it has an unread dot',
  check(_board, views) {
    for (const view of views) {
      ensure((view.group === 'unread') === view.unreadPrKeys.length > 0, `${view.tile.id}: group ${view.group}, dots ${view.unreadPrKeys.join(', ') || 'none'}`);
    }
  },
};

/** The topic's unread count (sidebar bubble; the footer adds the topics up) is the number of unread tiles, snoozed ones with an unread thread included. */
export const unreadCountIsUnreadTiles: Invariant = {
  name: "a topic's unread count is its number of unread tiles",
  check(board, views) {
    const urgency = topicUrgency(
      views.map((view) => ({
        state: view.state.kind,
        unreadOnGitHub: view.state.unreadOnGitHub,
        loud: view.state.loud,
        unreadPrKeys: view.unreadPrKeys,
        prStates: view.prs.map((row) => row.state),
        move: topicMove(view.turn),
        quiet: false,
      })),
    );
    const unread = views.filter((view) => isUnreadBySpec(board, view)).length;
    ensure(urgency.unreadTiles === unread, `unread count ${urgency.unreadTiles}, unread tiles by the spec ${unread}`);
    const inGroup = views.filter((view) => view.group === 'unread').length;
    ensure(urgency.unreadTiles === inGroup, `unread count ${urgency.unreadTiles}, tiles in the Unread group ${inGroup}`);
  },
};

/**
 * The coral NEW pill shows exactly on an unread tile whose headline (the
 * last unread reason) is not automation left quiet: never on a bot's or CI's
 * headline unless it was raised to loud. A reason without an event (new
 * activity on GitHub) is not automation.
 */
export const newBadgeNeverOnAutomationHeadline: Invariant = {
  name: 'the NEW pill shows on unread tiles only, never on an automation headline left quiet',
  check(board, views) {
    for (const view of views) {
      const headline = view.state.unreadBecause.at(-1);
      let expected = false;
      if (view.state.kind === 'unread' && headline) {
        const event = eventsOf(board, headline.prKey).find((candidate) => candidate.id === headline.eventId);
        const automation = event !== undefined && isAutomationEvent(prOf(board, headline.prKey), board.viewer, event);
        expected = !automation || effectiveLoudnessOf(event) === 'loud';
      }
      ensure(view.newBadge === expected, `${view.tile.id}: NEW ${view.newBadge}, expected ${expected} (headline ${headline?.eventId ?? 'none'})`);
    }
  },
};

/** The groups come in the order Unread, Open, Dealt with, and an empty group is not shown. */
export const groupsInOrder: Invariant = {
  name: 'the groups come in the order Unread, Open, Dealt with, empty ones left out',
  check(_board, views) {
    const groups = groupTiles(views);
    const order = groups.map((entry) => GROUP_ORDER.indexOf(entry.group));
    ensure(order.every((rank, index) => rank >= 0 && (index === 0 || order[index - 1]! < rank)), `groups ${groups.map((entry) => entry.group).join(', ')}`);
    ensure(groups.every((entry) => entry.tiles.length > 0), 'an empty group is shown');
  },
};

export const SCREEN_INVARIANTS: readonly Invariant[] = [everyTileInOneGroup, unreadGroupIffDotted, unreadCountIsUnreadTiles, newBadgeNeverOnAutomationHeadline, groupsInOrder];

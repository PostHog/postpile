// Tile-level invariants: state, whose turn, lead PR and the buttons
// (DESIGN.md "Tile faces", "Actions act on what you look at", "Rules layer:
// one home per fact").
import { isTracked } from '../provenance.ts';
import { snoozePhase } from '../snooze.ts';
import { isPrDone } from '../tiles.ts';
import type { WhoseTurnKind } from '../whose-turn.ts';
import type { PaneOffers } from '../offers.ts';
import type { TileView } from '../views.ts';
import { tileViewsOf, type PropertyBoard } from './build-board.ts';
import { describeTurn, ensure, eventsOf, isNews, prOf, sameMove, trackedMembers, trackedRows, type Invariant } from './invariant.ts';

const TURN_RANK: Record<WhoseTurnKind, number> = { you: 0, them: 1, none: 2 };

function isSnoozedByRule(board: PropertyBoard, view: TileView): boolean {
  const tracked = trackedMembers(view);
  return (
    tracked.length > 0 &&
    tracked.every((member) => {
      const snooze = board.snoozes.get(member.prKey);
      if (!snooze) {
        return false;
      }
      const context = { pr: prOf(board, member.prKey), events: eventsOf(board, member.prKey), now: board.now, viewer: board.viewer };
      return snoozePhase(snooze, context) === 'active';
    })
  );
}

function prDone(board: PropertyBoard, key: string): boolean {
  return isPrDone(prOf(board, key), board.userStates.get(key) ?? null, board.viewer, eventsOf(board, key), board.notYours.has(key));
}

/** A tile is snoozed exactly while every tracked PR in it has an active snooze (DESIGN "Snoozes belong to PRs"). */
export const snoozedWhileEveryTrackedPrSnoozed: Invariant = {
  name: 'a tile is snoozed exactly while every tracked PR has an active snooze',
  check(board, views) {
    for (const view of views) {
      const expected = isSnoozedByRule(board, view);
      ensure((view.state.kind === 'snoozed') === expected, `${view.tile.id}: state ${view.state.kind}, every tracked PR snoozed: ${expected}`);
    }
  },
};

/** Unread: not snoozed, and a pinged or pulled-in PR has loud news (a found PR never makes its tile unread). */
export const unreadWhileLoudNews: Invariant = {
  name: 'a tile is unread exactly while not snoozed and a non-found PR has unseen loud news',
  check(board, views) {
    for (const view of views) {
      const news = view.tile.members.filter((member) => member.provenance.kind !== 'found').flatMap((member) => eventsOf(board, member.prKey).filter(isNews));
      const expected = view.state.kind !== 'snoozed' && news.length > 0;
      ensure((view.state.kind === 'unread') === expected, `${view.tile.id}: state ${view.state.kind}, ${news.length} loud news`);
      if (view.state.kind === 'unread') {
        const reasons = view.state.unreadBecause.map((reason) => reason.eventId).sort();
        ensure(JSON.stringify(reasons) === JSON.stringify(news.map((event) => event.id).sort()), `${view.tile.id}: unread reasons are not the loud news`);
      }
    }
  },
};

/** Done: not snoozed, not unread, and every tracked PR done by `isPrDone`; each row's done is that PR's. */
export const doneWhileEveryTrackedPrDone: Invariant = {
  name: 'a tile is done exactly while not snoozed, not unread and every tracked PR is done',
  check(board, views) {
    for (const view of views) {
      for (const row of view.prs) {
        ensure(row.done === prDone(board, row.key), `${row.key}: row done ${row.done}, isPrDone ${!row.done}`);
      }
      const allDone = trackedMembers(view).every((member) => prDone(board, member.prKey));
      const expected = view.state.kind !== 'snoozed' && view.state.kind !== 'unread' && allDone;
      ensure((view.state.kind === 'done') === expected, `${view.tile.id}: state ${view.state.kind}, every tracked PR done: ${allDone}`);
    }
  },
};

/** The grey "merged without you" strip only shows on an open tile, for tracked PRs the glance did not call not yours. */
export const unseenMergesOnlyOnOpenTiles: Invariant = {
  name: 'unseen merges without review show only on open tiles, for tracked PRs that are not NOT_YOURS',
  check(board, views) {
    for (const view of views) {
      for (const reason of view.state.unseenMerges ?? []) {
        const member = view.tile.members.find((candidate) => candidate.prKey === reason.prKey);
        ensure(view.state.kind === 'open', `${view.tile.id}: unseen merge on a ${view.state.kind} tile`);
        ensure(member !== undefined && isTracked(member.provenance) && !board.notYours.has(reason.prKey), `${reason.prKey}: unseen merge from an untracked or NOT_YOURS PR`);
      }
    }
  },
};

/** The tile's turn is the most urgent turn of its tracked PRs, and names the same move as that PR's row. */
export const tileTurnIsAPrTurn: Invariant = {
  name: 'the tile turn is the most urgent turn of one of its tracked PRs',
  check(_board, views) {
    for (const view of views) {
      const rows = trackedRows(view);
      const best = Math.min(...rows.map((row) => TURN_RANK[row.turn.kind]), TURN_RANK.none);
      ensure(TURN_RANK[view.turn.kind] === best, `${view.tile.id}: tile turn ${view.turn.kind}, most urgent row turn rank ${best}`);
      if (view.turn.kind === 'none') {
        continue;
      }
      const row = rows.find((candidate) => candidate.key === view.turn.prKey);
      ensure(row !== undefined, `${view.tile.id}: tile turn names ${view.turn.prKey}, no tracked row`);
      ensure(sameMove(row!.turn, view.turn), `${view.tile.id}: tile turn ${describeTurn(view.turn)}, row turn ${describeTurn(row!.turn)}`);
    }
  },
};

/**
 * Among the tracked PRs whose turn is as urgent as the tile's, the tile
 * talks about the one with the newest loud news, so the footer and the
 * unread strip name the same PR; with no news, the first in tile order.
 */
export const tileTurnFollowsNewestNews: Invariant = {
  name: 'the tile turn talks about the PR with the newest news, else the first',
  check(board, views) {
    for (const view of views) {
      if (view.turn.kind === 'none') {
        continue;
      }
      const tied = trackedRows(view).filter((row) => row.turn.kind === view.turn.kind);
      const newestNews = (key: string) => eventsOf(board, key).filter(isNews).map((event) => event.at).sort().at(-1) ?? '';
      const newest = tied.map((row) => newestNews(row.key)).sort().at(-1) ?? '';
      const withNewest = tied.filter((row) => newestNews(row.key) === newest);
      if (withNewest.length === 1 || newest === '') {
        ensure(view.turn.prKey === withNewest[0]!.key, `${view.tile.id}: turn on ${view.turn.prKey}, newest news on ${withNewest[0]!.key}`);
      }
    }
  },
};

export const leadPrIsTurnPr: Invariant = {
  name: 'the lead PR is the PR of the tile turn',
  check(_board, views) {
    for (const view of views) {
      if (view.turn.kind !== 'none') {
        ensure(view.offers.leadPrKey === view.turn.prKey, `${view.tile.id}: lead ${view.offers.leadPrKey}, turn on ${view.turn.prKey}`);
      }
    }
  },
};

/** A done PR asks nothing of the viewer: never their move. */
export const donePrIsNeverYourMove: Invariant = {
  name: 'a done PR is never your move',
  check(_board, views) {
    for (const view of views) {
      for (const row of view.prs) {
        ensure(!row.done || row.turn.kind !== 'you', `${row.key}: done but ${describeTurn(row.turn)}`);
      }
    }
  },
};

function onlyOpen(pane: PaneOffers): boolean {
  return pane.lead === 'open_on_github' && pane.open && !pane.approve && !pane.ask && pane.markLabel === null && pane.removeTeams.length === 0;
}

export const doneTileOffersOnlyOpen: Invariant = {
  name: 'a done tile offers only Open, on the footer and every pane',
  check(_board, views) {
    for (const view of views.filter((candidate) => candidate.state.kind === 'done')) {
      const { footer, markLabel, snooze, github } = view.offers;
      ensure(footer === 'open' && markLabel === null && !snooze && github === null, `${view.tile.id}: done tile footer ${footer}, mark ${markLabel}, snooze ${snooze}`);
      for (const row of view.prs) {
        const pane = view.offers.pane[row.key]!;
        ensure(onlyOpen(pane) && !pane.snooze, `${row.key}: done tile pane leads with ${pane.lead}`);
      }
    }
  },
};

/** A done PR offers only Open; with unseen news it keeps Mark read, never Approve, Ask or Remove team. */
export const donePrOffersOnlyOpen: Invariant = {
  name: 'a done PR offers only Open, or Mark read while its news is unseen',
  check(_board, views) {
    for (const view of views) {
      for (const row of view.prs.filter((candidate) => candidate.done)) {
        const pane = view.offers.pane[row.key]!;
        ensure(!pane.approve && !pane.ask && pane.removeTeams.length === 0, `${row.key}: done PR offers Approve, Ask or Remove team`);
        if (row.unseenLoudEvents === 0) {
          ensure(onlyOpen(pane), `${row.key}: done PR with nothing unseen leads with ${pane.lead}`);
        } else if (view.state.kind !== 'done') {
          ensure(pane.markLabel !== null, `${row.key}: done PR with unseen news offers no mark button`);
        }
      }
    }
  },
};

/** A snoozed tile whose tracked PRs are all done with their news seen leads with Open, footer and panes (DESIGN "Actions act on what you look at"). */
export const snoozedAllDoneLeadsWithOpen: Invariant = {
  name: 'a snoozed tile with every tracked PR done and seen leads with Open',
  check(_board, views) {
    for (const view of views.filter((candidate) => candidate.state.kind === 'snoozed')) {
      const rows = trackedRows(view);
      if (rows.length === 0 || !rows.every((row) => row.done && row.unseenLoudEvents === 0)) {
        continue;
      }
      ensure(view.offers.footer === 'open' && view.offers.markLabel === null && view.offers.snooze, `${view.tile.id}: footer ${view.offers.footer}`);
      for (const row of rows) {
        ensure(view.offers.pane[row.key]!.lead === 'open_on_github', `${row.key}: pane leads with ${view.offers.pane[row.key]!.lead}`);
      }
    }
  },
};

/** Snooze leads the footer exactly on a read tile that is still your move, with the GitHub link next to it. */
export const snoozeLeadsOnlyWhileYourMove: Invariant = {
  name: 'Snooze leads the footer exactly on an open tile that is your move',
  check(_board, views) {
    for (const view of views) {
      const expected = view.state.kind === 'open' && view.turn.kind === 'you';
      ensure((view.offers.footer === 'snooze') === expected, `${view.tile.id}: footer ${view.offers.footer}, state ${view.state.kind}, turn ${view.turn.kind}`);
      ensure((view.offers.github !== null) === (view.offers.footer === 'snooze' && view.prs.some((row) => row.url !== '')), `${view.tile.id}: GitHub link without Snooze`);
    }
  },
};

/** "Mark done" only where a mark-read leaves nothing asked (DESIGN "Tile faces": the button never promises more than it does). */
export const markDoneNeverLeavesAMove: Invariant = {
  name: 'a Mark done label never leaves a move',
  check(_board, views) {
    for (const view of views) {
      if (view.offers.markLabel === 'Mark done') {
        ensure(view.afterRead.done && view.afterRead.turn.kind !== 'you', `${view.tile.id}: Mark done, after read ${describeTurn(view.afterRead.turn)}`);
      }
      for (const row of view.prs) {
        if (view.offers.pane[row.key]!.markLabel === 'Mark done') {
          ensure(row.afterRead.done && row.afterRead.turn.kind !== 'you', `${row.key}: pane Mark done, after read ${describeTurn(row.afterRead.turn)}`);
        }
      }
    }
  },
};

/** A waiting GitHub write changes no button: the pane only says it waits. */
export const pendingWritesChangeNoButton: Invariant = {
  name: 'a pending write changes no button',
  check(board, views) {
    if (board.pendingWrites.size === 0) {
      return;
    }
    const without = tileViewsOf({ ...board, pendingWrites: new Map() });
    const buttons = (list: TileView[]) =>
      list.map((view) => ({
        footer: view.offers.footer,
        markLabel: view.offers.markLabel,
        lead: view.offers.leadPrKey,
        pane: Object.values(view.offers.pane).map((pane) => ({ ...pane, pendingWrite: null })),
      }));
    ensure(JSON.stringify(buttons(views)) === JSON.stringify(buttons(without)), 'buttons differ with and without pending writes');
  },
};

export const TILE_INVARIANTS: readonly Invariant[] = [
  snoozedWhileEveryTrackedPrSnoozed,
  unreadWhileLoudNews,
  doneWhileEveryTrackedPrDone,
  unseenMergesOnlyOnOpenTiles,
  tileTurnIsAPrTurn,
  tileTurnFollowsNewestNews,
  leadPrIsTurnPr,
  donePrIsNeverYourMove,
  doneTileOffersOnlyOpen,
  donePrOffersOnlyOpen,
  snoozedAllDoneLeadsWithOpen,
  snoozeLeadsOnlyWhileYourMove,
  markDoneNeverLeavesAMove,
  pendingWritesChangeNoButton,
];

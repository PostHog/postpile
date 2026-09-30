// Tile-level invariants: state, whose turn, lead PR and the buttons
// (DESIGN.md "Tile faces", "Actions act on what you look at", "Rules layer:
// one home per fact").
import type { WhoseTurn, WhoseTurnKind } from '../whose-turn.ts';
import type { PaneOffers } from '../offers.ts';
import type { PrTier } from '../pr-tier.ts';
import { tileListRank } from '../tile-view.ts';
import type { PrSummary, TileView } from '../views.ts';
import { tileViewOf, tileViewsOf, type PropertyBoard } from './build-board.ts';
import { describeTurn, ensure, eventsOf, isNews, isTrackedHere, prOf, sameMove, trackedMembers, trackedRows, type Invariant } from './invariant.ts';
import { expectedFooter, expectedGitHubLink, expectedLeadPr, expectedMarkLabel, expectedPane, expectedPrimaryAction } from './spec-offers.ts';
import { expectedDone, expectedSnoozePhase, isUnseenMergeWithoutViewer } from './spec-rules.ts';

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
      return expectedSnoozePhase({ pr: prOf(board, member.prKey), events: eventsOf(board, member.prKey), viewer: board.viewer, snooze, now: board.now }) === 'active';
    })
  );
}

/** Done by the spec (spec-rules.ts `expectedDone`), not by `isPrDone`. */
function prDone(board: PropertyBoard, key: string): boolean {
  return expectedDone({ pr: prOf(board, key), events: eventsOf(board, key), viewer: board.viewer, userState: board.userStates.get(key) ?? null, notYours: board.notYours.has(key) });
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

/** The members whose notification thread is unread on GitHub. */
function unreadThreadKeys(board: PropertyBoard, view: TileView): string[] {
  return view.tile.members.filter((member) => board.threads.get(member.prKey)?.unread === true).map((member) => member.prKey);
}

/** Unseen loud news on a pinged or pulled-in PR (a found PR's news never counts for the tile). */
function tileNews(board: PropertyBoard, view: TileView) {
  return view.tile.members.filter((member) => member.provenance.kind !== 'found').flatMap((member) => eventsOf(board, member.prKey).filter(isNews));
}

/**
 * Why one PR's unread thread keeps its tile unread, from the board: its loud
 * news; else its newest unseen quiet event after the thread's read; else the
 * thread itself.
 */
function expectedReasonIds(board: PropertyBoard, key: string): string[] {
  const events = eventsOf(board, key);
  const news = events.filter(isNews);
  if (news.length > 0) {
    return news.map((event) => event.id);
  }
  const thread = board.threads.get(key)!;
  const quiet = events.filter((event) => {
    const loudness = event.override ? event.override.loudness : event.ruleLoudness;
    return event.seenAt === null && loudness === 'quiet' && (thread.lastReadAt === null || event.at > thread.lastReadAt);
  });
  return quiet.length > 0 ? [quiet.at(-1)!.id] : [`thread:${thread.id}`];
}

/**
 * GitHub unread is PostPile unread (2026-09-30): a tile is unread exactly
 * while it is not snoozed and one of its threads is unread on GitHub,
 * whatever else holds (done, loud or not). The reasons name each unread
 * thread's PR, oldest first.
 */
export const unreadWhileAThreadIsUnread: Invariant = {
  name: 'a tile is unread exactly while not snoozed and a thread of it is unread on GitHub',
  check(board, views) {
    for (const view of views) {
      const unreadKeys = unreadThreadKeys(board, view);
      const expected = view.state.kind !== 'snoozed' && unreadKeys.length > 0;
      ensure((view.state.kind === 'unread') === expected, `${view.tile.id}: state ${view.state.kind}, ${unreadKeys.length} unread threads`);
      if (view.state.kind === 'unread') {
        const reasons = view.state.unreadBecause.map((reason) => reason.eventId).sort();
        const want = unreadKeys.flatMap((key) => expectedReasonIds(board, key)).sort();
        ensure(JSON.stringify(reasons) === JSON.stringify(want), `${view.tile.id}: unread reasons ${reasons.join(', ')}, expected ${want.join(', ')}`);
        const times = view.state.unreadBecause.map((reason) => reason.at);
        ensure(times.every((time, index) => index === 0 || times[index - 1]! <= time), `${view.tile.id}: unread reasons out of time order`);
        ensure(view.state.unreadBecause.every((reason) => unreadKeys.includes(reason.prKey)), `${view.tile.id}: a reason names a PR whose thread is read`);
      } else {
        ensure(view.state.unreadBecause.length === 0, `${view.tile.id}: ${view.state.kind} tile with unread reasons`);
      }
    }
  },
};

/** `unreadOnGitHub` says whether a thread of the tile is unread, on every state (a snoozed tile counts in the Unread filter); `loud` whether a non-found PR has unseen loud news. */
export const unreadOnGitHubAndLoudFollowTheBoard: Invariant = {
  name: 'unreadOnGitHub follows the threads and loud follows the loud news, in every state, and each row says whether its thread is unread',
  check(board, views) {
    for (const view of views) {
      const unread = unreadThreadKeys(board, view).length > 0;
      ensure(view.state.unreadOnGitHub === unread, `${view.tile.id}: unreadOnGitHub ${view.state.unreadOnGitHub}, unread threads ${unread}`);
      const loud = tileNews(board, view).length > 0;
      ensure(view.state.loud === loud, `${view.tile.id}: loud ${view.state.loud}, loud news ${loud}`);
      for (const row of view.prs) {
        const threadUnread = board.threads.get(row.key)?.unread === true;
        ensure(row.unreadOnGitHub === threadUnread, `${row.key}: row unreadOnGitHub ${row.unreadOnGitHub}, thread unread ${threadUnread}`);
      }
    }
  },
};

/** No "done here, unread there": a done tile never holds a thread unread on GitHub (DESIGN "GitHub unread is PostPile unread"). */
export const doneNeverWhileAThreadIsUnread: Invariant = {
  name: 'a done tile never holds a thread unread on GitHub',
  check(board, views) {
    for (const view of views.filter((candidate) => candidate.state.kind === 'done')) {
      ensure(unreadThreadKeys(board, view).length === 0, `${view.tile.id}: done with an unread thread`);
    }
  },
};

/** Done: not snoozed, not unread, no loud news, and every tracked PR done by the spec. */
export const doneWhileEveryTrackedPrDone: Invariant = {
  name: 'a tile is done exactly while not snoozed, not unread, without loud news and every tracked PR is done',
  check(board, views) {
    for (const view of views) {
      const allDone = trackedMembers(view).every((member) => prDone(board, member.prKey));
      const news = tileNews(board, view).length > 0;
      const expected = view.state.kind !== 'snoozed' && view.state.kind !== 'unread' && !news && allDone;
      ensure((view.state.kind === 'done') === expected, `${view.tile.id}: state ${view.state.kind}, every tracked PR done: ${allDone}, loud news ${news}`);
    }
  },
};

/**
 * The grey "merged without you" strip shows on an open tile, for exactly
 * the unseen merges without the viewer's review on tracked PRs the glance
 * did not call not yours; no other state carries it.
 */
export const unseenMergesOnlyOnOpenTiles: Invariant = {
  name: 'unseen merges without review show exactly on open tiles, for tracked PRs that are not NOT_YOURS',
  check(board, views) {
    for (const view of views) {
      const merges = trackedMembers(view)
        .filter((member) => !board.notYours.has(member.prKey))
        .flatMap((member) => eventsOf(board, member.prKey).filter(isUnseenMergeWithoutViewer))
        .map((event) => event.id)
        .sort();
      const shown = (view.state.unseenMerges ?? []).map((reason) => reason.eventId).sort();
      const expected = view.state.kind === 'open' ? merges : [];
      ensure(JSON.stringify(shown) === JSON.stringify(expected), `${view.tile.id}: ${view.state.kind} tile shows merges ${shown.join(', ')}, expected ${expected.join(', ')}`);
      ensure(view.state.unseenMerges === undefined || shown.length > 0, `${view.tile.id}: an empty merge strip`);
    }
  },
};

/** A row's words on the tile: a multi-PR tile names the PR ("Review, ada asked on #12"; "Waiting on sol and 1 more on #12"). */
function tileWords(turn: WhoseTurn, where: string): string {
  if (where === '') {
    return turn.what;
  }
  return turn.kind === 'them' && turn.lead === 'Waiting on' ? [turn.what, where].filter((part) => part !== '').join(' ') : `${turn.what} ${where}`;
}

/** The tile's turn is the most urgent turn of its tracked PRs, names the same move as that PR's row, in the row's words plus the PR on a multi-PR tile. */
export const tileTurnIsAPrTurn: Invariant = {
  name: 'the tile turn is the most urgent turn of one of its tracked PRs, in its words',
  check(board, views) {
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
      const what = tileWords(row!.turn, view.tile.members.length > 1 ? `on #${prOf(board, row!.key).ref.number}` : '');
      ensure(view.turn.what === what, `${view.tile.id}: tile says "${view.turn.what}", expected "${what}"`);
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

/** A done PR offers only Open; with unseen news or its thread unread on GitHub it keeps Mark read, never Approve, Ask or Remove team. */
export const donePrOffersOnlyOpen: Invariant = {
  name: 'a done PR offers only Open, or Mark read while its news is unseen or its thread unread',
  check(_board, views) {
    for (const view of views) {
      for (const row of view.prs.filter((candidate) => candidate.done)) {
        const pane = view.offers.pane[row.key]!;
        ensure(!pane.approve && !pane.ask && pane.removeTeams.length === 0, `${row.key}: done PR offers Approve, Ask or Remove team`);
        if (row.unseenLoudEvents === 0 && !row.unreadOnGitHub) {
          ensure(onlyOpen(pane), `${row.key}: done PR with nothing unseen leads with ${pane.lead}`);
        } else if (view.state.kind !== 'done') {
          ensure(pane.markLabel !== null, `${row.key}: done PR with unseen news or an unread thread offers no mark button`);
        }
      }
    }
  },
};

/** A snoozed tile whose tracked PRs are all done with their news seen and threads read leads with Open, footer and panes (DESIGN "Actions act on what you look at"). */
export const snoozedAllDoneLeadsWithOpen: Invariant = {
  name: 'a snoozed tile with every tracked PR done and seen leads with Open',
  check(_board, views) {
    for (const view of views.filter((candidate) => candidate.state.kind === 'snoozed')) {
      const rows = trackedRows(view);
      if (rows.length === 0 || !rows.every((row) => row.done && row.unseenLoudEvents === 0 && !row.unreadOnGitHub)) {
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

/** Unseen loud news that keeps the tile from being done: a found PR's news never does. */
function hasTileNews(board: PropertyBoard, row: PrSummary): boolean {
  return row.provenance.kind !== 'found' && eventsOf(board, row.key).some(isNews);
}

/** The PR's thread is unread on GitHub, which keeps its tile unread (2026-09-30). */
function hasUnreadThread(board: PropertyBoard, row: PrSummary): boolean {
  return board.threads.get(row.key)?.unread === true;
}

/**
 * The PRs that can hold a tile, spelled out from the board: tracked PRs,
 * and pulled-in stack layers with unseen loud news (2026-09-30).
 */
function rowsThatCanHold(board: PropertyBoard, view: TileView): PrSummary[] {
  return view.prs.filter((row) => isTrackedHere(row.provenance) || hasTileNews(board, row));
}

/**
 * One "Not done yet" dot per PR that keeps a live tile from being done: not
 * done, with unseen loud news (a pulled-in layer counts by its news), or
 * with its thread unread on GitHub. Only on unread or open tiles where more
 * than one PR can hold the tile.
 */
export const oneDotPerNotDonePr: Invariant = {
  name: 'one Not done yet dot per PR that holds a live tile, only where more than one PR can hold it',
  check(board, views) {
    for (const view of views) {
      const dots = [...view.notDonePrKeys].sort();
      const holders = rowsThatCanHold(board, view);
      const live = view.state.kind === 'unread' || view.state.kind === 'open';
      if (!live || holders.length <= 1) {
        ensure(dots.length === 0, `${view.tile.id}: dots on a ${view.state.kind} tile with ${holders.length} PRs that can hold it`);
        continue;
      }
      const expected = holders.filter((row) => !row.done || hasTileNews(board, row) || hasUnreadThread(board, row)).map((row) => row.key).sort();
      ensure(JSON.stringify(dots) === JSON.stringify(expected), `${view.tile.id}: dots ${dots.join(', ')}, not done ${expected.join(', ')}`);
    }
  },
};

/**
 * "No dots left, the tile is done": a live tile where more than one PR can
 * hold it always dots the one that does, also when only a pulled-in layer
 * has news (decided 2026-09-30; before, such a tile was unread with no dot).
 */
export const liveTileShowsWhatHoldsIt: Invariant = {
  name: 'a live tile with more than one PR that can hold it dots at least one',
  check(board, views) {
    for (const view of views) {
      const live = view.state.kind === 'unread' || view.state.kind === 'open';
      if (live && rowsThatCanHold(board, view).length > 1) {
        ensure(view.notDonePrKeys.length > 0, `${view.tile.id}: ${view.state.kind} tile without a dot`);
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

/**
 * The list order in a topic (2026-09-29): unread, open, snoozed, done, and
 * a read tile that is still your move ranks with the unread ones.
 */
export const tileListOrderFollowsState: Invariant = {
  name: 'a tile ranks by state, and an open tile that is your move ranks with the unread',
  check(_board, views) {
    const rank = { unread: 0, open: 1, snoozed: 2, done: 3 };
    for (const view of views) {
      const expected = view.state.kind === 'open' && view.turn.kind === 'you' ? rank.unread : rank[view.state.kind];
      ensure(tileListRank(view) === expected, `${view.tile.id}: rank ${tileListRank(view)}, expected ${expected}`);
    }
  },
};

/** The queue order, spelled out here (not `PR_TIER_ORDER`). */
const TIER_ORDER: readonly PrTier[] = ['needs_reply', 'changes_requested', 'mine', 'team', 'to_review', 'team_mentioned', 'rest'];

/** A tile sits in the queue of its most urgent PR; a pulled-in layer's tier is always the rest. */
export const tileTierIsMostUrgentRowTier: Invariant = {
  name: 'the tile tier is the most urgent tier of its rows',
  check(_board, views) {
    for (const view of views) {
      const expected = TIER_ORDER.find((tier) => view.prs.some((row) => row.tier === tier)) ?? 'rest';
      ensure(view.tier === expected, `${view.tile.id}: tier ${view.tier}, rows ${view.prs.map((row) => row.tier).join(', ')}`);
    }
  },
};

function paneLine(pane: Pick<PaneOffers, 'scope' | 'lead' | 'approve' | 'open' | 'ask' | 'markLabel' | 'snooze' | 'removeTeams'>): string {
  return JSON.stringify([pane.scope, pane.lead, pane.approve, pane.open, pane.ask, pane.markLabel, pane.snooze, pane.removeTeams]);
}

/**
 * Every button follows the spec (spec-offers.ts): the footer and its label,
 * Snooze on every tile that is not done, the lead PR, the GitHub link next
 * to Snooze, each PR's primary action and its pane.
 */
export const offersFollowTheSpec: Invariant = {
  name: 'the footer, lead PR, GitHub link, primary actions and every pane follow the spec',
  check(board, views) {
    for (const view of views) {
      const { offers } = view;
      const footer = expectedFooter(view);
      ensure(offers.footer === footer && offers.markLabel === expectedMarkLabel(footer), `${view.tile.id}: footer ${offers.footer} (${offers.markLabel}), expected ${footer}`);
      ensure(offers.snooze === (view.state.kind !== 'done'), `${view.tile.id}: Snooze ${offers.snooze} on a ${view.state.kind} tile`);
      ensure(offers.leadPrKey === expectedLeadPr(view), `${view.tile.id}: lead ${offers.leadPrKey}, expected ${expectedLeadPr(view)}`);
      const link = footer === 'snooze' ? expectedGitHubLink(view, board.viewer) : null;
      ensure(JSON.stringify(offers.github) === JSON.stringify(link), `${view.tile.id}: GitHub link ${JSON.stringify(offers.github)}, expected ${JSON.stringify(link)}`);
      for (const row of view.prs) {
        const pr = prOf(board, row.key);
        const primary = expectedPrimaryAction(pr, board.viewer, board.userStates.get(row.key) ?? null, view.state.kind === 'unread');
        ensure(row.primaryAction === primary, `${row.key}: primary ${row.primaryAction}, expected ${primary}`);
        const pane = offers.pane[row.key]!;
        const expected = paneLine(expectedPane(view, row, pr, board.viewer));
        ensure(paneLine(pane) === expected, `${row.key}: pane ${paneLine(pane)}, expected ${expected}`);
        const write = pane.scope === 'tile' ? view.pendingWrite : row.pendingWrite;
        ensure(pane.pendingWrite === write, `${row.key}: pane waits on the wrong write`);
      }
    }
  },
};

/**
 * Before the first sync stored a viewer nothing is aimed at anyone: no
 * move, every PR the rest, no request, touch, ask or team request, and done
 * is an in-app approval or handled (or a finished PR seen).
 */
export const noViewerAsksNothing: Invariant = {
  name: 'without a viewer nothing is anyone\'s move and done is approved in the app or handled',
  check(board) {
    for (const tile of board.tiles) {
      const view = tileViewOf(board, tile, null);
      ensure(view.turn.kind === 'none', `${tile.id}: tile turn ${describeTurn(view.turn)} without a viewer`);
      for (const row of view.prs) {
        ensure(row.turn.kind === 'none' && row.tier === 'rest', `${row.key}: ${describeTurn(row.turn)}, tier ${row.tier} without a viewer`);
        const facts = row.facts;
        ensure(facts.reviewRequest === null && facts.lastTouch === null && facts.openAsk === null && row.ownTeamRequests.length === 0, `${row.key}: facts without a viewer`);
        const done = expectedDone({ pr: prOf(board, row.key), events: eventsOf(board, row.key), viewer: null, userState: board.userStates.get(row.key) ?? null, notYours: board.notYours.has(row.key) });
        ensure(row.done === done, `${row.key}: done ${row.done} without a viewer, expected ${done}`);
      }
    }
  },
};

export const TILE_INVARIANTS: readonly Invariant[] = [
  snoozedWhileEveryTrackedPrSnoozed,
  unreadWhileAThreadIsUnread,
  unreadOnGitHubAndLoudFollowTheBoard,
  doneNeverWhileAThreadIsUnread,
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
  oneDotPerNotDonePr,
  liveTileShowsWhatHoldsIt,
  pendingWritesChangeNoButton,
  tileTierIsMostUrgentRowTier,
  tileListOrderFollowsState,
  offersFollowTheSpec,
  noViewerAsksNothing,
];

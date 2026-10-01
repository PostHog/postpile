// Read invariants: the one read planner, what a mark-read promises, and that
// handled survives new activity (DESIGN.md "Reading a PR is one planner",
// "Handled is not reset by new activity").
import { deriveEvents } from '../events.ts';
import { openedReadCheck } from '../quiet-reads.ts';
import { applyReadPlan, planRead, prReadScope, tileReadScope, type ReadCause, type ReadScope } from '../read-plan.ts';
import type { IsoTime, Pr, PrKey, Tile, UserPrState } from '../types.ts';
import { tileViewOf, tileStateOf, withReadState, type PropertyBoard } from './build-board.ts';
import { describeTurn, ensure, eventsOf, isTrackedHere, prOf, sameMove, trackedRows, type Invariant } from './invariant.ts';
import { pendingRequest } from './spec-facts.ts';
import { expectedOpenedRead, expectedReadPlan } from './spec-rules.ts';

/** The board with the threads of `keys` read on GitHub up to their last update, as a mark-read that reached GitHub leaves them. */
export function withThreadsRead(board: PropertyBoard, keys: PrKey[]): PropertyBoard {
  const threads = new Map(board.threads);
  for (const key of keys) {
    const thread = threads.get(key);
    if (thread?.unread) {
      threads.set(key, { ...thread, unread: false, lastReadAt: thread.updatedAt });
    }
  }
  return { ...board, threads };
}

/** The board with the thread of `key` unread again after new activity at `at` (GitHub flags it), when the PR has one. */
export function withThreadUnread(board: PropertyBoard, key: PrKey, at: IsoTime): PropertyBoard {
  const thread = board.threads.get(key);
  if (!thread) {
    return board;
  }
  const threads = new Map(board.threads);
  threads.set(key, { ...thread, unread: true, updatedAt: at });
  return { ...board, threads };
}

/**
 * The board after a read of `scope` by `cause`, through the planner, as the
 * engine writes it. Every cause but GitHub's own read time also reads the
 * scope's threads on GitHub (the button, Approve, an open, a sent pending
 * write, a quiet read): the tile follows the thread.
 */
export function afterRead(board: PropertyBoard, scope: ReadScope, cause: ReadCause, at: IsoTime = board.now): PropertyBoard {
  const plan = planRead({ scope, cause, events: board.events, userStates: board.userStates, at });
  const applied = applyReadPlan(plan, board.events, board.userStates);
  const read = withReadState(board, applied.events, applied.userStates);
  return cause.kind === 'read_on_github' ? read : withThreadsRead(read, scope.prKeys);
}

/** A few read times per board: the oldest event, a middle one, now. */
function readTimes(board: PropertyBoard): IsoTime[] {
  const times = [...board.events.values()].flat().map((event) => event.at).sort();
  return [...new Set([times[0], times[Math.floor(times.length / 2)], board.now].filter((time): time is IsoTime => time !== undefined))];
}

function causesAt(time: IsoTime): ReadCause[] {
  return [
    { kind: 'button' },
    { kind: 'approved' },
    { kind: 'opened' },
    { kind: 'pending_completion', clickedAt: time },
    { kind: 'read_on_github', readAt: time },
    { kind: 'quiet', readAt: time },
  ];
}

function scopesOf(tile: Tile): ReadScope[] {
  return [tileReadScope(tile), ...tile.members.map((member) => prReadScope(member.prKey, isTrackedHere(member.provenance)))];
}

/** A tile read covers every PR of the tile and handles its pinged and found ones, never a pulled-in layer. */
export const readScopesFollowTheTile: Invariant = {
  name: 'a tile read covers every PR of the tile and handles only the tracked ones',
  check(board) {
    for (const tile of board.tiles) {
      const scope = tileReadScope(tile);
      const tracked = tile.members.filter((member) => isTrackedHere(member.provenance)).map((member) => member.prKey);
      ensure(JSON.stringify(scope.prKeys) === JSON.stringify(tile.members.map((member) => member.prKey)), `${tile.id}: read covers ${scope.prKeys.join(', ')}`);
      ensure(JSON.stringify(scope.handleKeys) === JSON.stringify(tracked), `${tile.id}: read handles ${scope.handleKeys.join(', ')}, tracked ${tracked.join(', ')}`);
    }
  },
};

/**
 * The planner is the spec's (spec-rules.ts `expectedReadPlan`): which events
 * turn seen, stamped when, which PRs turn handled. Liveness: after a read
 * without a cutoff (the button, opening, Approve) nothing in its scope is
 * unseen; with one, nothing at or before it. An earlier handled time stays,
 * and a second read changes nothing.
 */
export const readPlannerCauses: Invariant = {
  name: 'the read planner: who handles, what turns seen, what stays, nothing unseen left behind',
  check(board) {
    for (const tile of board.tiles) {
      for (const scope of scopesOf(tile)) {
        for (const time of readTimes(board)) {
          for (const cause of causesAt(time)) {
            const input = { scope, cause, events: board.events, userStates: board.userStates, at: board.now };
            const plan = planRead(input);
            const got = JSON.stringify({ seenAt: plan.seenAt, handledAt: plan.handledAt, handleKeys: plan.handleKeys, eventIds: plan.change.eventIds, handledKeys: plan.change.handledKeys });
            const expected = JSON.stringify(expectedReadPlan(input));
            ensure(got === expected, `${cause.kind}: plan ${got}, expected ${expected}`);
            const cutoff = cause.kind === 'pending_completion' ? cause.clickedAt : cause.kind === 'read_on_github' || cause.kind === 'quiet' ? cause.readAt : null;
            const after = applyReadPlan(plan, board.events, board.userStates);
            for (const key of scope.prKeys) {
              const left = (after.events.get(key) ?? []).filter((event) => event.seenAt === null && (cutoff === null || event.at <= cutoff));
              ensure(left.length === 0, `${cause.kind}: ${left.map((event) => event.id).join(', ')} still unseen after the read`);
            }
            const marked = new Set(plan.change.eventIds);
            for (const [key, events] of board.events) {
              events.forEach((event, index) => {
                const next = after.events.get(key)![index]!;
                const expectedSeen = marked.has(event.id) ? plan.seenAt : event.seenAt;
                ensure(next.seenAt === expectedSeen, `${cause.kind}: ${event.id} seen at ${next.seenAt}, expected ${expectedSeen}`);
              });
            }
            for (const key of new Set([...board.userStates.keys(), ...plan.change.handledKeys])) {
              const before = board.userStates.get(key)?.handledAt ?? null;
              const expectedHandled = plan.change.handledKeys.includes(key) ? plan.handledAt : before;
              ensure((after.userStates.get(key)?.handledAt ?? null) === expectedHandled, `${cause.kind}: handled time of ${key} moved`);
            }
            const again = planRead({ scope, cause, events: after.events, userStates: after.userStates, at: board.now });
            ensure(again.change.eventIds.length === 0 && again.change.handledKeys.length === 0, `${cause.kind}: a second read changes more`);
          }
        }
      }
    }
  },
};

/** The tile's after-read preview is what the real read leaves: same done, same whose move. */
export const tileAfterReadIsTheRealRead: Invariant = {
  name: "a tile's after-read preview matches the board after the real read",
  check(board, views) {
    for (const view of views) {
      const read = afterRead(board, tileReadScope(view.tile), { kind: 'button' });
      const next = tileViewOf(read, view.tile);
      ensure(sameMove(next.turn, view.afterRead.turn) && next.turn.what === view.afterRead.turn.what, `${view.tile.id}: preview ${describeTurn(view.afterRead.turn)}, real ${describeTurn(next.turn)}`);
      if (next.state.kind !== 'snoozed') {
        ensure((next.state.kind === 'done') === view.afterRead.done, `${view.tile.id}: preview done ${view.afterRead.done}, real state ${next.state.kind}`);
      }
    }
  },
};

/** Each tracked PR's after-read preview is what reading that PR alone leaves. */
export const prAfterReadIsTheRealRead: Invariant = {
  name: "a PR's after-read preview matches the board after reading that PR",
  check(board, views) {
    for (const view of views) {
      for (const row of trackedRows(view)) {
        const read = afterRead(board, prReadScope(row.key, true), { kind: 'button' });
        const next = tileViewOf(read, view.tile).prs.find((candidate) => candidate.key === row.key)!;
        ensure(next.done === row.afterRead.done, `${row.key}: preview done ${row.afterRead.done}, real ${next.done}`);
        ensure(JSON.stringify(next.turn) === JSON.stringify(row.afterRead.turn), `${row.key}: preview ${describeTurn(row.afterRead.turn)}, real ${describeTurn(next.turn)}`);
      }
    }
  },
};

/** Opening a PR marks it read only when that leaves it done: afterwards it is done and not the viewer's move. */
export const openedReadLeavesDone: Invariant = {
  name: 'opening a PR reads it only when that leaves it done',
  check(board, views) {
    for (const view of views) {
      for (const row of trackedRows(view)) {
        const thread = board.threads.get(row.key) ?? null;
        const holding = board.tiles.filter((tile) => tile.members.some((member) => member.prKey === row.key));
        const tilesSnoozed = holding.map((tile) => tileStateOf(board, tile).kind === 'snoozed');
        const input = { thread, prFetchedAt: board.prFetchedAt.get(row.key) ?? null, tilesSnoozed, doneAfterRead: row.afterRead.done };
        const check = openedReadCheck({ ...input, tiles: tilesSnoozed.map((snoozed) => ({ snoozed })) });
        // Also as if no tile held it, or it had no thread: nothing to mirror then.
        for (const variant of [input, { ...input, tilesSnoozed: [] }, { ...input, thread: null }]) {
          const got = JSON.stringify(openedReadCheck({ ...variant, tiles: variant.tilesSnoozed.map((snoozed) => ({ snoozed })) }));
          const expected = JSON.stringify(expectedOpenedRead(variant));
          ensure(got === expected, `${row.key}: opened read ${got}, expected ${expected}`);
        }
        if (check.kind === 'skip') {
          continue;
        }
        const read = afterRead(board, prReadScope(row.key, true), { kind: 'opened' });
        const next = tileViewOf(read, view.tile).prs.find((candidate) => candidate.key === row.key)!;
        ensure(next.done && next.turn.kind !== 'you', `${row.key}: opened read leaves done ${next.done}, ${describeTurn(next.turn)}`);
      }
    }
  },
};

/**
 * A new snapshot as the store takes it: events derived again, seen and
 * overrides kept by id, app-made events kept (`EventRepo.upsertDerived`).
 */
export function resync(board: PropertyBoard, pr: Pr): PropertyBoard {
  const stored = new Map(eventsOf(board, pr.key).map((event) => [event.id, event]));
  const derived = deriveEvents(pr, board.viewer, board.userStates.get(pr.key) ?? null).map((event) => {
    const old = stored.get(event.id);
    return old ? { ...event, seenAt: old.seenAt, override: old.override } : event;
  });
  const appMade = eventsOf(board, pr.key).filter((event) => event.kind === 'look_closer');
  const events = new Map(board.events);
  events.set(pr.key, [...derived, ...appMade]);
  const prs = new Map(board.prs);
  prs.set(pr.key, pr);
  return { ...board, prs, events };
}

/** ada mentions the viewer now, after everything else. */
function withNewMention(pr: Pr, now: IsoTime): Pr {
  const comment = { id: `late-${pr.ref.number}`, author: 'ada', body: '@viewer one more thing', createdAt: now, kind: 'comment' as const, url: `${pr.url}#late`, path: null, threadId: null };
  return { ...pr, comments: [...pr.comments, comment], updatedAt: now };
}

/** Handled means "you dealt with this once" (decided 2026-09-29): a later mention (GitHub flags the thread unread) makes the tile unread and leaves handled alone. */
export const handledSurvivesNewActivity: Invariant = {
  name: 'handled survives new activity, which makes the tile unread',
  check(board, views) {
    for (const view of views) {
      for (const row of trackedRows(view)) {
        const state: UserPrState | undefined = board.userStates.get(row.key);
        if (!state?.handledAt || row.provenance.kind === 'found') {
          continue;
        }
        const next = withThreadUnread(resync(board, withNewMention(prOf(board, row.key), board.now)), row.key, board.now);
        ensure(next.userStates.get(row.key)?.handledAt === state.handledAt, `${row.key}: handled time moved`);
        const nextState = tileStateOf(next, view.tile);
        ensure(nextState.kind === 'unread', `${row.key}: a new mention leaves the tile ${nextState.kind}`);
      }
    }
  },
};

/** The viewer comments now, after everything else. */
function withViewerComment(pr: Pr, now: IsoTime): Pr {
  const comment = { id: `answer-${pr.ref.number}`, author: 'viewer', body: 'done, have a look', createdAt: now, kind: 'comment' as const, url: `${pr.url}#answer`, path: null, threadId: null };
  return { ...pr, comments: [...pr.comments, comment], updatedAt: now };
}

/**
 * Answering is a touch (metamorphic): once the viewer comments, no ask is
 * open (no Reply move, not Needs reply) and the author's answer to their
 * changes request is taken (no Re-review for it). A re-review asked for
 * by a pending request, personal or for the viewer's team, stays (decided
 * 2026-09-30: a comment does not answer a request).
 */
export const answeringClearsTheAsk: Invariant = {
  name: 'a comment by the viewer clears every Reply and answered-changes Re-review, and Needs reply',
  check(board, views) {
    for (const view of views) {
      for (const row of trackedRows(view)) {
        const pr = withViewerComment(prOf(board, row.key), board.now);
        const next = tileViewOf(resync(board, pr), view.tile).prs.find((candidate) => candidate.key === row.key)!;
        const move = next.turn.kind === 'you' ? next.turn.move : null;
        const request = pendingRequest(pr, board.viewer);
        const reRequested = request === 'you' || request === 'team_for_you' || request === 'team';
        ensure(move !== 'reply' && (move !== 're_review' || reRequested), `${row.key}: after the viewer's comment ${describeTurn(next.turn)}`);
        ensure(next.tier !== 'needs_reply', `${row.key}: still Needs reply after the viewer's comment`);
      }
    }
  },
};

export const READ_INVARIANTS: readonly Invariant[] = [readScopesFollowTheTile, readPlannerCauses, tileAfterReadIsTheRealRead, prAfterReadIsTheRealRead, openedReadLeavesDone, handledSurvivesNewActivity, answeringClearsTheAsk];


// Read invariants: the one read planner, what a mark-read promises, and that
// handled survives new activity (DESIGN.md "Reading a PR is one planner",
// "Handled is not reset by new activity").
import { deriveEvents } from '../events.ts';
import { isTracked } from '../provenance.ts';
import { openedReadCheck } from '../quiet-reads.ts';
import { applyReadPlan, planRead, prReadScope, tileReadScope, type ReadCause, type ReadScope } from '../read-plan.ts';
import type { IsoTime, Pr, PrEvent, Tile, UserPrState } from '../types.ts';
import { tileViewOf, tileStateOf, withReadState, type PropertyBoard } from './build-board.ts';
import { describeTurn, ensure, eventsOf, prOf, sameMove, trackedRows, type Invariant } from './invariant.ts';

/** The board after a read of `scope` by `cause`, through the planner, as the engine writes it. */
export function afterRead(board: PropertyBoard, scope: ReadScope, cause: ReadCause, at: IsoTime = board.now): PropertyBoard {
  const plan = planRead({ scope, cause, events: board.events, userStates: board.userStates, at });
  const applied = applyReadPlan(plan, board.events, board.userStates);
  return withReadState(board, applied.events, applied.userStates);
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
  return [tileReadScope(tile), ...tile.members.map((member) => prReadScope(member.prKey, isTracked(member.provenance)))];
}

/** Only the button, opening and a completed pending read handle; seen stays inside the scope and before the cause's cutoff; an earlier handled time stays. */
export const readPlannerCauses: Invariant = {
  name: 'the read planner: who handles, what turns seen, what stays',
  check(board) {
    for (const tile of board.tiles) {
      for (const scope of scopesOf(tile)) {
        for (const time of readTimes(board)) {
          for (const cause of causesAt(time)) {
            const plan = planRead({ scope, cause, events: board.events, userStates: board.userStates, at: board.now });
            const handles = cause.kind === 'button' || cause.kind === 'opened' || cause.kind === 'pending_completion';
            ensure(handles || plan.handleKeys.length === 0, `${cause.kind} handles ${plan.handleKeys.join(', ')}`);
            ensure(plan.handleKeys.every((key) => scope.handleKeys.includes(key)), `${cause.kind}: handles a PR outside the scope's handle keys`);
            const cutoff = cause.kind === 'pending_completion' ? cause.clickedAt : cause.kind === 'read_on_github' || cause.kind === 'quiet' ? cause.readAt : null;
            const inScope = new Map<string, PrEvent>(scope.prKeys.flatMap((key) => eventsOf(board, key).map((event) => [event.id, event] as const)));
            for (const id of plan.change.eventIds) {
              const event = inScope.get(id);
              ensure(event !== undefined, `${cause.kind}: marks ${id} of a PR outside its scope`);
              ensure(event!.seenAt === null, `${cause.kind}: marks the seen event ${id} again`);
              ensure(cutoff === null || event!.at <= cutoff, `${cause.kind}: marks ${id} after its cutoff`);
            }
            const after = applyReadPlan(plan, board.events, board.userStates);
            for (const [key, state] of board.userStates) {
              if (state.handledAt !== null) {
                ensure(after.userStates.get(key)?.handledAt === state.handledAt, `${cause.kind}: moves the handled time of ${key}`);
              }
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
        const check = openedReadCheck({
          thread,
          prFetchedAt: board.prFetchedAt.get(row.key) ?? null,
          prTruncated: prOf(board, row.key).truncated === true,
          tiles: holding.map((tile) => ({ snoozed: tileStateOf(board, tile).kind === 'snoozed' })),
          doneAfterRead: row.afterRead.done,
        });
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

/** Handled means "you dealt with this once" (decided 2026-09-29): a later mention makes the tile unread and leaves handled alone. */
export const handledSurvivesNewActivity: Invariant = {
  name: 'handled survives new activity, which makes the tile unread',
  check(board, views) {
    for (const view of views) {
      for (const row of trackedRows(view)) {
        const state: UserPrState | undefined = board.userStates.get(row.key);
        if (!state?.handledAt || row.provenance.kind === 'found') {
          continue;
        }
        const next = resync(board, withNewMention(prOf(board, row.key), board.now));
        ensure(next.userStates.get(row.key)?.handledAt === state.handledAt, `${row.key}: handled time moved`);
        const nextState = tileStateOf(next, view.tile);
        ensure(nextState.kind === 'unread', `${row.key}: a new mention leaves the tile ${nextState.kind}`);
      }
    }
  },
};

export const READ_INVARIANTS: readonly Invariant[] = [readPlannerCauses, tileAfterReadIsTheRealRead, prAfterReadIsTheRealRead, openedReadLeavesDone, handledSurvivesNewActivity];


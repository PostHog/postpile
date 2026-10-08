// What a tile turns into once it is marked read, so the tile can say what
// its button really does (2026-09-29: "Done for now" on a tile that stays your
// move promised something it could not do). Same rules as the tile state and
// whose turn, run over the data as a mark-read leaves it: the read planner's
// success branch applied to a copy, so the button never promises more than
// the action does.
import { isTracked } from './provenance.ts';
import { applyReadPlan, planRead, prReadScope, tileReadScope } from './read-plan.ts';
import { isPrDone } from './tiles.ts';
import type { IsoTime, Pr, PrEvent, PrKey, Tile, UserPrState, Viewer } from './types.ts';
import { NO_TURN, prWhoseTurn, whoseTurn, type WhoseTurn } from './whose-turn.ts';

/** What a mark-read would leave, for a whole tile (`tileAfterMarkRead`) or one PR (`prAfterMarkRead`). */
export interface TileAfterRead {
  /** Every pinged PR would be done (for one PR: that PR would be): nothing is asked of the viewer any more. */
  done: boolean;
  /** Whose move it would be. A team mention stops asking once read; a review or an answer to your changes does not. */
  turn: WhoseTurn;
}

export interface AfterReadInput {
  tile: Tile;
  prs: Map<PrKey, Pr>;
  events: Map<PrKey, PrEvent[]>;
  userStates: Map<PrKey, UserPrState>;
  viewer: Viewer | null;
  /** PRs whose agent glance says NOT_YOURS (see `teamRequestHold`). */
  notYours?: ReadonlySet<PrKey>;
  /** When the mark-read happens; the rules only look at whether seen / handled are set. */
  readAt: IsoTime;
}

/** The tile's data as a Mark read of the whole tile leaves it: the planner's success branch, on a copy. */
function tileAfterRead(input: AfterReadInput): { events: Map<PrKey, PrEvent[]>; userStates: Map<PrKey, UserPrState> } {
  const plan = planRead({ scope: tileReadScope(input.tile), cause: { kind: 'button' }, events: input.events, userStates: input.userStates, at: input.readAt });
  return applyReadPlan(plan, input.events, input.userStates);
}

/**
 * The tile after a mark-read: done only when nothing is asked of the viewer
 * any more (`isPrDone` for every pinged PR), and whose move it would be.
 * "Done for now" is honest only when `done` is true.
 */
export function tileAfterMarkRead(input: AfterReadInput): TileAfterRead {
  const { events, userStates } = tileAfterRead(input);
  const tracked = input.tile.members.filter((m) => isTracked(m.provenance));
  const done = tracked.every((member) => {
    const pr = input.prs.get(member.prKey);
    if (!pr) {
      return false;
    }
    return isPrDone(pr, userStates.get(member.prKey) ?? null, input.viewer, events.get(member.prKey) ?? [], input.notYours?.has(member.prKey) ?? false);
  });
  const turn = whoseTurn({ tile: input.tile, prs: input.prs, events, userStates, viewer: input.viewer, notYours: input.notYours });
  return { done, turn };
}

export interface PrAfterReadInput {
  pr: Pr;
  events: PrEvent[];
  userState: UserPrState | null;
  viewer: Viewer | null;
  /** The PR's glance says NOT_YOURS (see `teamRequestHold`). */
  notYours: boolean;
  /** Pinged or found in its tile, so a mark-read handles it. A pulled-in stack layer only gets its events seen and is never done. */
  tracked: boolean;
  readAt: IsoTime;
  /** The layers below it in its tile's stack, bottom first, as its row's turn reads them. */
  layersBelow?: Pr[];
}

/**
 * One PR after a mark-read of that PR alone (the detail pane's Mark read /
 * Done for now, 2026-09-29): its events seen, handled when tracked. `done` is
 * `isPrDone` over that, `turn` the PR's own whose turn. The detail pane says
 * "Done for now" only when `done` is true.
 */
export function prAfterMarkRead(input: PrAfterReadInput): TileAfterRead {
  const key = input.pr.key;
  const before = {
    events: new Map([[key, input.events]]),
    userStates: new Map<PrKey, UserPrState>(input.userState ? [[key, input.userState]] : []),
  };
  const plan = planRead({ scope: prReadScope(key, input.tracked), cause: { kind: 'button' }, ...before, at: input.readAt });
  const after = applyReadPlan(plan, before.events, before.userStates);
  const events = after.events.get(key) ?? [];
  const userState = after.userStates.get(key) ?? null;
  const done = input.tracked && isPrDone(input.pr, userState, input.viewer, events, input.notYours);
  const turn = input.viewer ? prWhoseTurn({ pr: input.pr, events, userState, viewer: input.viewer, notYours: input.notYours, layersBelow: input.layersBelow }) : NO_TURN;
  return { done, turn };
}

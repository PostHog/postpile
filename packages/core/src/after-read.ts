// What a tile turns into once it is marked read, so the tile can say what
// its button really does (2026-09-29: "Mark done" on a tile that stays your
// move promised something it could not do). Same rules as the tile state and
// whose turn, run over the data as a mark-read leaves it.
import { isTracked } from './provenance.ts';
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

/** The PR's events as a mark-read leaves them: every one seen. */
function seenEvents(events: PrEvent[], readAt: IsoTime): PrEvent[] {
  return events.map((event) => (event.seenAt === null ? { ...event, seenAt: readAt } : event));
}

/** The PR's user state as a mark-read leaves it: handled (an earlier handled time stays). */
function handledState(prKey: PrKey, state: UserPrState | null, readAt: IsoTime): UserPrState {
  const current = state ?? { prKey, approvedAt: null, approvedCommitOid: null, handledAt: null };
  return { ...current, handledAt: current.handledAt ?? readAt };
}

/** Every event of the tile's PRs seen, like ReadMarker does it. */
function eventsAfterRead(input: AfterReadInput): Map<PrKey, PrEvent[]> {
  const events = new Map(input.events);
  for (const member of input.tile.members) {
    events.set(member.prKey, seenEvents(input.events.get(member.prKey) ?? [], input.readAt));
  }
  return events;
}

/** Pinged and found PRs handled, like ReadMarker does it; pulled-in stack layers stay as they are. */
function userStatesAfterRead(input: AfterReadInput): Map<PrKey, UserPrState> {
  const states = new Map(input.userStates);
  for (const member of input.tile.members.filter((m) => isTracked(m.provenance))) {
    states.set(member.prKey, handledState(member.prKey, input.userStates.get(member.prKey) ?? null, input.readAt));
  }
  return states;
}

/**
 * The tile after a mark-read: done only when nothing is asked of the viewer
 * any more (`isPrDone` for every pinged PR), and whose move it would be.
 * "Mark done" is honest only when `done` is true.
 */
export function tileAfterMarkRead(input: AfterReadInput): TileAfterRead {
  const events = eventsAfterRead(input);
  const userStates = userStatesAfterRead(input);
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
}

/**
 * One PR after a mark-read of that PR alone (the detail pane's Mark read /
 * Mark done, 2026-09-29): its events seen, handled when tracked. `done` is
 * `isPrDone` over that, `turn` the PR's own whose turn. The detail pane says
 * "Mark done" only when `done` is true.
 */
export function prAfterMarkRead(input: PrAfterReadInput): TileAfterRead {
  const events = seenEvents(input.events, input.readAt);
  const userState = input.tracked ? handledState(input.pr.key, input.userState, input.readAt) : input.userState;
  const done = input.tracked && isPrDone(input.pr, userState, input.viewer, events, input.notYours);
  const turn = input.viewer ? prWhoseTurn({ pr: input.pr, events, userState, viewer: input.viewer, notYours: input.notYours }) : NO_TURN;
  return { done, turn };
}

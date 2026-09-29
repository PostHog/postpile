// What a tile turns into once it is marked read, so the tile can say what
// its button really does (2026-09-29: "Mark done" on a tile that stays your
// move promised something it could not do). Same rules as the tile state and
// whose turn, run over the data as a mark-read leaves it.
import { isTracked } from './provenance.ts';
import { isPrDone } from './tiles.ts';
import type { IsoTime, Pr, PrEvent, PrKey, Tile, UserPrState, Viewer } from './types.ts';
import { whoseTurn, type WhoseTurn } from './whose-turn.ts';

export interface TileAfterRead {
  /** Every pinged PR would be done: nothing is asked of the viewer any more. */
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
  /** When the mark-read happens; the rules only look at whether seen / handled are set. */
  readAt: IsoTime;
}

/** Every event of the tile's PRs seen, like ReadMarker does it. */
function eventsAfterRead(input: AfterReadInput): Map<PrKey, PrEvent[]> {
  const events = new Map(input.events);
  for (const member of input.tile.members) {
    const list = input.events.get(member.prKey) ?? [];
    events.set(
      member.prKey,
      list.map((event) => (event.seenAt === null ? { ...event, seenAt: input.readAt } : event)),
    );
  }
  return events;
}

/** Pinged and found PRs handled, like ReadMarker does it; pulled-in stack layers stay as they are. */
function userStatesAfterRead(input: AfterReadInput): Map<PrKey, UserPrState> {
  const states = new Map(input.userStates);
  for (const member of input.tile.members.filter((m) => isTracked(m.provenance))) {
    const state = input.userStates.get(member.prKey) ?? { prKey: member.prKey, approvedAt: null, approvedCommitOid: null, handledAt: null };
    states.set(member.prKey, { ...state, handledAt: state.handledAt ?? input.readAt });
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
    return isPrDone(pr, userStates.get(member.prKey) ?? null, input.viewer, events.get(member.prKey) ?? []);
  });
  const turn = whoseTurn({ tile: input.tile, prs: input.prs, events, userStates, viewer: input.viewer });
  return { done, turn };
}

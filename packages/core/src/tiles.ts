import type { IsoTime, Pr, PrEvent, PrKey, Snooze, Tile, TileState, UserPrState } from './types.ts';

export interface TileStateInput {
  tile: Tile;
  prs: Map<PrKey, Pr>;
  events: Map<PrKey, PrEvent[]>;
  userStates: Map<PrKey, UserPrState>;
  snooze: Snooze | null;
  now: IsoTime;
}

/** A pinged PR is done once the user approved or handled it, or it is merged/closed. */
export function isPrDone(_pr: Pr, _userState: UserPrState | null): boolean {
  throw new Error('not implemented');
}

/**
 * unread: some member has an unseen loud event (reasons listed).
 * snoozed: a snooze is active and its condition is not met yet.
 * done: every pinged member is done and nothing loud is unseen.
 * open: everything else.
 */
export function deriveTileState(_input: TileStateInput): TileState {
  throw new Error('not implemented');
}

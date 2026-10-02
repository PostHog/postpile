// Reading a PR is one planner (DESIGN.md "Rules layer: one home per fact").
// Every way a PR turns read in PostPile says here what changes in the app:
// which events turn seen (up to which cutoff, stamped when), which PRs turn
// handled, and what an undo puts back. Each cause keeps its own eligibility
// checks and GitHub write path in the engine; this only plans the local side.
// The inbox cleanup is one bulk GitHub write and does not come through here.
//
// Handled is never reset by new activity (decided 2026-09-29): it means "you
// dealt with this once". New loud activity makes the tile unread before done
// is checked; only an undo or a mark-read GitHub did not take puts it back.
import { isTracked } from './provenance.ts';
import type { IsoTime, PrEvent, PrKey, Tile, UserPrState } from './types.ts';

/** Why a PR turns read. */
export type ReadCause =
  /** Mark read / Done for now on a tile or PR, Not mine, the debug view, Remove team: everything seen now, the scope's handle keys handled. */
  | { kind: 'button' }
  /** Approve's (or a comment review's) follow-up mark-read: everything seen now, nothing handled (the review answers the ask). */
  | { kind: 'approved' }
  /** Opened in PostPile, after `openedReadCheck`: everything seen now, handled. */
  | { kind: 'opened' }
  /** A pending mark-read reached GitHub (or GitHub had it read): what the user saw at the click seen, handle keys handled. */
  | { kind: 'pending_completion'; clickedAt: IsoTime }
  /** GitHub's read time for the thread (sync, poll): events up to it seen, stamped with it, never handled. */
  | { kind: 'read_on_github'; readAt: IsoTime }
  /** A quiet mark-read (bots only, you acted after, opened) mirrored after GitHub took it: like a read on GitHub, never handled. */
  | { kind: 'quiet'; readAt: IsoTime };

/** Which PRs a read covers, and which of them may turn handled. */
export interface ReadScope {
  prKeys: PrKey[];
  /** Tracked PRs (pinged or found); a pulled-in stack layer only gets its events seen. */
  handleKeys: PrKey[];
}

/** What a read changed in the app, so an undo (or parking the batch) can put it back. */
export interface ReadChange {
  eventIds: string[];
  handledKeys: PrKey[];
}

export const NO_READ_CHANGE: ReadChange = { eventIds: [], handledKeys: [] };

export interface ReadPlan {
  /** The time the seen events are stamped with. */
  seenAt: IsoTime;
  /** The time newly handled PRs are stamped with. */
  handledAt: IsoTime;
  /**
   * PRs this cause handles, handled already or not. A queued or pending
   * mark-read keeps them, so completing it later handles them.
   */
  handleKeys: PrKey[];
  /** What turns seen and handled here: exactly what an undo puts back. */
  change: ReadChange;
}

export interface ReadPlanInput {
  scope: ReadScope;
  cause: ReadCause;
  /** The scope's events as stored now. */
  events: ReadonlyMap<PrKey, PrEvent[]>;
  /** The scope's user states as stored now; a missing one means never handled. */
  userStates: ReadonlyMap<PrKey, UserPrState | null>;
  /** When the read happens. */
  at: IsoTime;
}

/** Every PR of the tile seen; tracked members (pinged or found) handled. */
export function tileReadScope(tile: Tile): ReadScope {
  return {
    prKeys: tile.members.map((member) => member.prKey),
    handleKeys: tile.members.filter((member) => isTracked(member.provenance)).map((member) => member.prKey),
  };
}

/** Several tiles read as one (the topic's "Mark N read"): each PR once, handled when any of the tiles tracks it. */
export function tilesReadScope(tiles: Tile[]): ReadScope {
  const scopes = tiles.map(tileReadScope);
  return {
    prKeys: [...new Set(scopes.flatMap((scope) => scope.prKeys))],
    handleKeys: [...new Set(scopes.flatMap((scope) => scope.handleKeys))],
  };
}

/** One PR seen, and handled when `handles` (the tile tracks it). */
export function prReadScope(key: PrKey, handles: boolean): ReadScope {
  return { prKeys: [key], handleKeys: handles ? [key] : [] };
}

interface CauseRule {
  /** Events after this stay unseen; null: every event. */
  seenUpTo: IsoTime | null;
  seenAt: IsoTime;
  handles: boolean;
}

function causeRule(cause: ReadCause, at: IsoTime): CauseRule {
  switch (cause.kind) {
    case 'button':
    case 'opened':
      return { seenUpTo: null, seenAt: at, handles: true };
    case 'approved':
      return { seenUpTo: null, seenAt: at, handles: false };
    case 'pending_completion':
      return { seenUpTo: cause.clickedAt, seenAt: at, handles: true };
    case 'read_on_github':
    case 'quiet':
      return { seenUpTo: cause.readAt, seenAt: cause.readAt, handles: false };
    default: {
      const never: never = cause;
      return never;
    }
  }
}

/** Unseen events at or before `upTo` (every unseen one when null). */
export function unseenUpTo(events: PrEvent[], upTo: IsoTime | null): string[] {
  return events.filter((event) => event.seenAt === null && (upTo === null || event.at <= upTo)).map((event) => event.id);
}

/** What a read does in the app. Pure: the engine applies the plan to the store, after-read to a copy. */
export function planRead(input: ReadPlanInput): ReadPlan {
  const rule = causeRule(input.cause, input.at);
  const eventIds = input.scope.prKeys.flatMap((key) => unseenUpTo(input.events.get(key) ?? [], rule.seenUpTo));
  const handleKeys = rule.handles ? input.scope.handleKeys.filter((key) => input.scope.prKeys.includes(key)) : [];
  const handledKeys = handleKeys.filter((key) => !input.userStates.get(key)?.handledAt);
  return { seenAt: rule.seenAt, handledAt: input.at, handleKeys, change: { eventIds, handledKeys } };
}

/** The events and user states as the plan leaves them, on copies (after-read). */
export function applyReadPlan(
  plan: ReadPlan,
  events: ReadonlyMap<PrKey, PrEvent[]>,
  userStates: ReadonlyMap<PrKey, UserPrState>,
): { events: Map<PrKey, PrEvent[]>; userStates: Map<PrKey, UserPrState> } {
  const seen = new Set(plan.change.eventIds);
  const nextEvents = new Map<PrKey, PrEvent[]>();
  for (const [key, list] of events) {
    nextEvents.set(key, list.map((event) => (seen.has(event.id) ? { ...event, seenAt: plan.seenAt } : event)));
  }
  const nextStates = new Map(userStates);
  for (const key of plan.change.handledKeys) {
    const current = userStates.get(key) ?? { prKey: key, approvedAt: null, approvedCommitOid: null, handledAt: null };
    nextStates.set(key, { ...current, handledAt: plan.handledAt });
  }
  return { events: nextEvents, userStates: nextStates };
}

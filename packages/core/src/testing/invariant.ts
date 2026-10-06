// The shape of one cross-rule invariant and the helpers every catalogue
// shares. An invariant throws with a plain message when a board breaks it;
// it does not depend on vitest, so a differential or a stateful test can run
// the same catalogue after each step.
import fc from 'fast-check';
import type { FullPr, Pr, PrEvent, PrKey, Provenance, TileMember } from '../types.ts';
import type { PrSummary, TileView } from '../views.ts';
import type { WhoseTurn } from '../whose-turn.ts';
import { boardSpecArb, type BoardSpec } from './board-spec.ts';
import { buildBoard, tileViewsOf, type PropertyBoard } from './build-board.ts';
import { propertyRuns } from './runs.ts';

export interface Invariant {
  name: string;
  /** Throws when the board breaks the invariant. */
  check: (board: PropertyBoard, views: TileView[]) => void;
}

export class InvariantBroken extends Error {}

/** Throws with `message` unless `holds`. */
export function ensure(holds: boolean, message: string): void {
  if (!holds) {
    throw new InvariantBroken(message);
  }
}

/** Runs one invariant over generated boards; fast-check shrinks a failure to a small spec. */
export function checkBoards(invariant: Invariant, runs: number = propertyRuns(), arbitrary: fc.Arbitrary<BoardSpec> = boardSpecArb): void {
  fc.assert(
    fc.property(arbitrary, (spec) => {
      const board = buildBoard(spec);
      invariant.check(board, tileViewsOf(board));
    }),
    { numRuns: runs },
  );
}

export function prOf(board: PropertyBoard, key: PrKey): Pr {
  const pr = board.prs.get(key);
  if (!pr) {
    throw new Error(`no PR ${key} on the board`);
  }
  return pr;
}

/** The PR with every stored body: for the spec oracles and for deriving events. */
export function fullPrOf(board: PropertyBoard, key: PrKey): FullPr {
  const pr = board.fullPrs.get(key);
  if (!pr) {
    throw new Error(`no PR ${key} on the board`);
  }
  return pr;
}

export function eventsOf(board: PropertyBoard, key: PrKey): PrEvent[] {
  return board.events.get(key) ?? [];
}

/** Pinged or found, not a pulled-in layer: spelled out here, not read from `isTracked`. */
export function isTrackedHere(provenance: Provenance): boolean {
  return provenance.kind !== 'pulled_in';
}

export function trackedMembers(view: TileView): TileMember[] {
  return view.tile.members.filter((member) => isTrackedHere(member.provenance));
}

export function trackedRows(view: TileView): PrSummary[] {
  return view.prs.filter((row) => isTrackedHere(row.provenance));
}

/** Loud as the agent or user left it, and not seen: spelled out here, not read from the rule under test. */
export function isNews(event: PrEvent): boolean {
  const loudness = event.override ? event.override.loudness : event.ruleLoudness;
  return event.seenAt === null && loudness === 'loud';
}

/**
 * The PRs of a tile that are unread, per "GitHub unread is PostPile unread"
 * (2026-09-30), spelled out from the board: a tracked thread unread on
 * GitHub; on an unread tile also a pulled-in layer with unseen loud news and
 * a not-found PR with an unseen Look closer event. A snoozed tile counts its
 * unread threads only. Open and done tiles have none.
 */
export function expectedUnreadRows(board: PropertyBoard, view: TileView): PrKey[] {
  if (view.state.kind !== 'unread' && view.state.kind !== 'snoozed') {
    return [];
  }
  const rows = view.prs.filter((row) => {
    if (board.threads.get(row.key)?.unread === true && row.provenance.kind !== 'found') {
      return true;
    }
    if (view.state.kind === 'snoozed') {
      return false;
    }
    const events = eventsOf(board, row.key);
    if (row.provenance.kind === 'pulled_in') {
      return events.some(isNews);
    }
    return row.provenance.kind !== 'found' && events.some((event) => event.kind === 'look_closer' && isNews(event));
  });
  return rows.map((row) => row.key);
}

/** Two turns name the same move on the same PR (the words differ between a tile and a row: " on #12"). */
export function sameMove(a: WhoseTurn, b: WhoseTurn): boolean {
  const moveOf = (turn: WhoseTurn) => (turn.kind === 'you' ? turn.move : null);
  return a.kind === b.kind && moveOf(a) === moveOf(b) && a.who === b.who && a.prKey === b.prKey && (a.lead ?? null) === (b.lead ?? null);
}

export function describeTurn(turn: WhoseTurn): string {
  return turn.kind === 'you' ? `you/${turn.move} on ${turn.prKey}` : `${turn.kind}${turn.who ? ` (${turn.who})` : ''} on ${turn.prKey ?? '-'}`;
}

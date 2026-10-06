// The board against the recipe: the builder makes events, seen marks, tiles
// and snoozes with the app's own rules (deriveEvents, eventsSeenByTouch,
// planRead, buildTopicTiles, snoozeWrites, lookCloserPingCheck), so these
// invariants check that what they made is what the recipe says happened,
// stated from the raw snapshot (spec-events.ts, spec-facts.ts,
// spec-layout.ts). Everything else builds on these boards.
import { deriveEvents } from '../events.ts';
import { snoozeWrites } from '../snooze.ts';
import { setIdFromTileId } from '../tiles.ts';
import type { PrEvent, PrKey } from '../types.ts';
import type { PropertyBoard } from './build-board.ts';
import { ensure, eventsOf, fullPrOf, type Invariant } from './invariant.ts';
import { expectedEvents, type ExpectedEvent } from './spec-events.ts';
import { isViewerLogin, newestTouch } from './spec-facts.ts';
import { expectedSnoozes, expectedTiles } from './spec-layout.ts';
import { expectedLookCloser } from './spec-rules.ts';

function describeEvent(event: Pick<ExpectedEvent, 'kind' | 'actor' | 'at' | 'isBot'> & { loudness: string }): string {
  return `${event.kind} by ${event.actor || '-'}${event.isBot ? ' (bot)' : ''} at ${event.at}, ${event.loudness}`;
}

/** Every derived event is one the snapshot gives, of the right kind, by the right actor, at the right time, with its rule loudness and reason; oldest first. */
export const eventsMatchTheSnapshot: Invariant = {
  name: 'each comment, review, commit, timeline item and CI run gives its event, kind and rule loudness',
  check(board) {
    for (const [key, pr] of board.fullPrs) {
      const userState = board.userStates.get(key) ?? null;
      const expected = new Map(expectedEvents(pr, board.viewer, userState).map((event) => [event.id, event]));
      const times = deriveEvents(pr, board.viewer, userState).map((event) => event.at);
      ensure(times.every((time, index) => index === 0 || times[index - 1]! <= time), `${key}: events not oldest first`);
      const derived = eventsOf(board, key).filter((event) => event.kind !== 'look_closer');
      const missing = [...expected.keys()].filter((id) => !derived.some((event) => event.id === id));
      ensure(missing.length === 0, `${key}: no event for ${missing.join(', ')}`);
      for (const event of derived) {
        const want = expected.get(event.id);
        ensure(want !== undefined, `${key}: unexpected event ${event.id}`);
        const got = describeEvent({ ...event, loudness: event.ruleLoudness });
        ensure(got === describeEvent(want!), `${event.id}: ${got}, expected ${describeEvent(want!)}`);
        ensure(event.ruleReason === want!.reason, `${event.id}: reason "${event.ruleReason}", expected "${want!.reason}"`);
      }
    }
  },
};

/**
 * What the sync and the app turned seen, from the recipe: everything up to
 * GitHub's read time, the viewer's own events on a thread read on GitHub,
 * everything up to the viewer's last touch, up to an in-app approval, and
 * up to a Mark read click. Nothing else. Mark read handles a tracked PR at
 * the click; nothing else handles.
 */
export const seenAndHandledFollowTheRecipe: Invariant = {
  name: 'seen and handled are exactly what the reads, touches and clicks of the recipe make them',
  check(board) {
    for (const [key, pr] of board.fullPrs) {
      const thread = board.threads.get(key) ?? null;
      const touch = newestTouch(pr, board.viewer);
      const approvedAt = board.userStates.get(key)?.approvedAt ?? null;
      const clickedAt = board.markedReadAt.get(key) ?? null;
      const upTo = [thread?.lastReadAt ?? null, touch?.at ?? null, approvedAt, clickedAt].filter((time): time is string => time !== null);
      for (const event of eventsOf(board, key)) {
        const ownOnReadThread = thread !== null && !thread.unread && isViewerLogin(board.viewer, event.actor);
        const expected = ownOnReadThread || upTo.some((time) => event.at <= time);
        ensure((event.seenAt !== null) === expected, `${event.id}: seen ${event.seenAt !== null}, expected ${expected}`);
      }
      const tracked = board.prSpecs.get(key)!.tracking.kind !== 'pulled_in';
      const handledAt = board.userStates.get(key)?.handledAt ?? null;
      const expectedHandled = tracked ? clickedAt : null;
      ensure(handledAt === expectedHandled, `${key}: handled at ${handledAt}, expected ${expectedHandled}`);
    }
  },
};

function memberLine(prKey: PrKey, provenance: unknown): string {
  return `${prKey} ${JSON.stringify(provenance)}`;
}

/** Tiles by the recipe: which tile each PR is in, in order, with its provenance, and the stacks each tile holds. */
export const tilesFollowTheRecipe: Invariant = {
  name: 'tiles follow the recipe: stacks whole and base to head, sets, singles, provenance',
  check(board) {
    const expected = expectedTiles(board);
    const got = board.tiles.map((tile) => ({ id: tile.id, kind: tile.kind, members: tile.members.map((member) => memberLine(member.prKey, member.provenance)), stacks: tile.stacks }));
    const want = expected.map((tile) => ({ id: tile.id, kind: tile.kind, members: tile.members.map((member) => memberLine(member.prKey, member.provenance)), stacks: tile.stacks }));
    ensure(JSON.stringify(got) === JSON.stringify(want), `tiles ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
    const ids = board.tiles.map((tile) => tile.id);
    ensure(new Set(ids).size === ids.length, `tile ids repeat: ${ids.join(', ')}`);
    for (const tile of board.tiles) {
      const setId = tile.kind === 'set' ? tile.id.slice('set:'.length) : null;
      ensure(setIdFromTileId(tile.id) === setId, `${tile.id}: set id ${setIdFromTileId(tile.id)}`);
    }
  },
};

/**
 * A whole-tile snooze lands on each tracked PR of the tile and never on a
 * pulled-in layer; a PR's own snooze only while it is tracked. Taking a
 * tile's snooze back removes it from every PR of the tile.
 */
export const snoozesFollowTheRecipe: Invariant = {
  name: 'snoozes land on the tracked PRs the recipe snoozed, never on a pulled-in layer, and come off the whole tile',
  check(board) {
    const expected = expectedSnoozes(board, expectedTiles(board));
    const got = new Map([...board.snoozes].map(([key, snooze]) => [key, snooze.condition.kind]));
    const line = (map: Map<string, string>) => JSON.stringify([...map].sort());
    ensure(line(got) === line(expected), `snoozes ${line(got)}, expected ${line(expected)}`);
    for (const tile of board.tiles) {
      const end = snoozeWrites(tile, { kind: 'end' });
      const members = tile.members.map((member) => member.prKey);
      ensure(end.put.length === 0 && JSON.stringify(end.remove) === JSON.stringify(members), `${tile.id}: unsnoozing removes ${end.remove.join(', ')}`);
    }
  },
};

function lookCloserEvents(board: PropertyBoard, key: PrKey): PrEvent[] {
  return eventsOf(board, key).filter((event) => event.kind === 'look_closer');
}

/** The Look closer event is there exactly when the recipe says the ping fired and the rule allowed it, for the request it names. */
export const lookCloserEventFollowsTheRecipe: Invariant = {
  name: 'a Look closer event is there exactly when the recipe fired the ping and the spec allows it',
  check(board) {
    for (const [key, spec] of board.prSpecs) {
      const pr = fullPrOf(board, key);
      const check = expectedLookCloser({ pr, viewer: board.viewer, verdict: 'LOOK_CLOSER', userState: board.userStates.get(key) ?? null, snoozed: false, pingedRequestId: null });
      const fired = spec.lookCloser && spec.glance === 'LOOK_CLOSER' && check.kind === 'ping';
      const events = lookCloserEvents(board, key);
      ensure(events.length === (fired ? 1 : 0), `${key}: ${events.length} Look closer events, fired ${fired}`);
      if (fired && check.kind === 'ping') {
        ensure(events[0]!.sourceId === check.requestId && events[0]!.ruleLoudness === 'loud', `${key}: Look closer event for ${events[0]!.sourceId}, expected ${check.requestId}`);
      }
    }
  },
};

export const BOARD_INVARIANTS: readonly Invariant[] = [eventsMatchTheSnapshot, seenAndHandledFollowTheRecipe, tilesFollowTheRecipe, snoozesFollowTheRecipe, lookCloserEventFollowsTheRecipe];

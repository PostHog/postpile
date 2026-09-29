// PR invariants over generated boards (testing/invariants-pr.ts), and one
// scenario per bug the properties found.
// POSTPILE_PROPERTY_RUNS=10000 pnpm test runs more boards per invariant.
import { describe, expect, it } from 'vitest';
import { pingRule } from '../pings.ts';
import { buildBoard, checkBoards, PR_INVARIANTS, PROPERTY_TIMEOUT_MS, tileStateOf, type BoardSpec, type PrSpec } from '../testing/index.ts';

describe('pr invariants', () => {
  for (const invariant of PR_INVARIANTS) {
    it(invariant.name, () => checkBoards(invariant), PROPERTY_TIMEOUT_MS);
  }
});

/** ada's open PR, pinged, with nothing else going on. */
const quietPr: PrSpec = {
  author: 'other',
  draft: false,
  steps: [],
  end: { kind: 'open' },
  ci: 'none',
  tracking: { kind: 'thread', reason: 'review_requested', readAfter: null },
  threadsResolved: false,
  approvedAfter: null,
  markedReadAfter: null,
  snooze: null,
  glance: null,
  lookCloser: false,
  overrides: [],
  truncated: false,
  staleSnapshot: false,
  pendingWrite: false,
};

describe('pings, scenarios the properties found', () => {
  // Found 2026-09-29 by "a ping is about unseen loud news and never comes
  // from a snoozed or done tile": a bot asked another team for a review, the
  // events agent raised that request to loud, and ada commented. A bot's
  // event never wakes a snooze, so the tile stayed snoozed, but the poll
  // still pinged for the raised request.
  it('a bot event the agent raised to loud does not ping from a snoozed tile', () => {
    const spec: BoardSpec = {
      groups: [
        {
          kind: 'single',
          prs: [
            {
              ...quietPr,
              steps: [
                { kind: 'request', target: 'other_team', byBot: true },
                { kind: 'comment', by: 'other', text: 'plain', thread: null },
              ],
              overrides: [{ pick: 1, loudness: 'loud' }],
            },
          ],
          snooze: { condition: 'until_time', after: 2, untilPassed: false },
        },
      ],
      writesLocked: false,
      teamMembersUnknown: false,
      nowGap: 60,
    };
    const board = buildBoard(spec);
    const tile = board.tiles[0]!;
    const pr = board.prs.get(tile.members[0]!.prKey)!;
    const fresh = (board.events.get(pr.key) ?? []).filter((event) => event.seenAt === null);
    expect(fresh.find((event) => event.kind === 'review_requested')?.override?.loudness).toBe('loud');
    expect(tileStateOf(board, tile).kind).toBe('snoozed');
    expect(pingRule(fresh, pr, board.viewer, false, true)).toMatchObject({ class: 'snoozed', reason: 'tile snoozed' });
    // Without the snooze the same events ping.
    expect(pingRule(fresh, pr, board.viewer, false, false).class).toBe('addressed');
  });
});

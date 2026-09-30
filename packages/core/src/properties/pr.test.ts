// PR invariants over generated boards (testing/invariants-pr.ts), and one
// scenario per bug the properties found.
// POSTPILE_PROPERTY_RUNS=10000 pnpm test runs more boards per invariant.
import { describe, expect, it } from 'vitest';
import { pingRule } from '../pings.ts';
import { buildBoard, checkBoards, PR_INVARIANTS, PROPERTY_TIMEOUT_MS, QUIET_PR, tileStateOf, tileViewsOf, type BoardSpec, type StepSpec } from '../testing/index.ts';

describe('pr invariants', () => {
  for (const invariant of PR_INVARIANTS) {
    it(invariant.name, () => checkBoards(invariant), PROPERTY_TIMEOUT_MS);
  }
});

describe('pings, scenarios the properties found', () => {
  /** A bot asked another team for a review and ada commented, on a snoozed tile; `raised`: the events agent made the request loud. */
  function snoozedBotRequestBoard(raised: boolean): BoardSpec {
    return {
      groups: [
        {
          kind: 'single',
          prs: [
            {
              ...QUIET_PR,
              steps: [
                { kind: 'request', target: 'other_team', byBot: true },
                { kind: 'comment', by: 'other', text: 'plain', thread: null },
              ],
              overrides: raised ? [{ pick: 1, loudness: 'loud' }] : [],
            },
          ],
          snooze: { condition: 'until_time', after: 2, untilPassed: false },
        },
      ],
      writesLocked: false,
      teamMembersUnknown: false,
      nowGap: 60,
    };
  }

  // Found 2026-09-29 by "a ping is about unseen loud news and never comes
  // from a snoozed or done tile": the events agent raised a bot's request to
  // loud, the snooze (human news only) held, but the poll still pinged.
  // First fixed by the `snoozed` ping row; decided 2026-09-30 that the
  // raised event wakes the snooze, so the tile turns unread and pings. The
  // row stays: a tile that is still snoozed never pings.
  it('a bot event the agent raised to loud wakes the snooze and pings', () => {
    const board = buildBoard(snoozedBotRequestBoard(true));
    const tile = board.tiles[0]!;
    const pr = board.prs.get(tile.members[0]!.prKey)!;
    const fresh = (board.events.get(pr.key) ?? []).filter((event) => event.seenAt === null);
    expect(fresh.find((event) => event.kind === 'review_requested')?.override?.loudness).toBe('loud');
    expect(tileStateOf(board, tile).kind).toBe('unread');
    expect(pingRule(fresh, pr, board.viewer, false, false).class).toBe('addressed');
    expect(pingRule(fresh, pr, board.viewer, false, true)).toMatchObject({ class: 'snoozed', reason: 'tile snoozed' });
  });

  it('a bot event at its rule loudness leaves the snooze alone', () => {
    const board = buildBoard(snoozedBotRequestBoard(false));
    expect(tileStateOf(board, board.tiles[0]!).kind).toBe('snoozed');
  });
});

describe('whose move, scenarios the properties found', () => {
  /** ada's PR: you asked for changes, ada asked you again, `pusher` pushed (or nobody did), and you only commented since. */
  function reRequestedBoard(pusher: 'other' | 'bot' | null): BoardSpec {
    const push: StepSpec[] = pusher === null ? [] : [{ kind: 'push', by: pusher, force: false }];
    const steps: StepSpec[] = [
      { kind: 'request', target: 'viewer', byBot: false },
      { kind: 'review', by: 'viewer', state: 'CHANGES_REQUESTED' },
      { kind: 'request', target: 'viewer', byBot: false },
      ...push,
      { kind: 'comment', by: 'viewer', text: 'plain', thread: null },
    ];
    return {
      groups: [{ kind: 'single', prs: [{ ...QUIET_PR, steps }], snooze: null }],
      writesLocked: false,
      teamMembersUnknown: false,
      nowGap: 60,
    };
  }

  // Found 2026-09-29 by "tier To review and whose move Review agree": the
  // PR sat under Changes you requested while the move said "Review, ada
  // asked". Decided 2026-09-30: the move is a re-review, the tier stays.
  for (const pusher of ['other', 'bot'] as const) {
    it(`a re-request after your changes is a Re-review under Changes you requested (${pusher} pushed)`, () => {
      const row = tileViewsOf(buildBoard(reRequestedBoard(pusher)))[0]!.prs[0]!;
      expect(row.tier).toBe('changes_requested');
      expect(row.turn).toMatchObject({ kind: 'you', move: 're_review', what: 'Re-review, ada asked' });
    });
  }

  // The same without a push said "ada to address your changes": the review
  // of the unchanged head still counted. Decided 2026-09-30: an explicit
  // re-request means "look again", push or not.
  it('a re-request after your changes without a push is a Re-review under Changes you requested', () => {
    const row = tileViewsOf(buildBoard(reRequestedBoard(null)))[0]!.prs[0]!;
    expect(row.tier).toBe('changes_requested');
    expect(row.turn).toMatchObject({ kind: 'you', move: 're_review', what: 'Re-review, ada asked' });
  });
});

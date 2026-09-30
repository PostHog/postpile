// Tile invariants over generated boards (testing/invariants-tile.ts), and
// one scenario per decision the properties led to.
// POSTPILE_PROPERTY_RUNS=10000 pnpm test runs more boards per invariant.
import { describe, expect, it } from 'vitest';
import { buildBoard, checkBoards, PROPERTY_TIMEOUT_MS, QUIET_PR, TILE_INVARIANTS, tileViewsOf, type BoardSpec } from '../testing/index.ts';

describe('tile invariants', () => {
  for (const invariant of TILE_INVARIANTS) {
    it(invariant.name, () => checkBoards(invariant), PROPERTY_TIMEOUT_MS);
  }
});

describe('Not done yet dots, scenarios the properties found', () => {
  // Found 2026-09-29 by "a live multi-PR tile dots at least one PR": ada
  // asked for changes on your pulled-in stack layer, the tile turned unread,
  // and no row had a dot. Decided 2026-09-30: the layer gets the dot.
  it('loud news on a pulled-in stack layer makes the tile unread and dots that layer', () => {
    const spec: BoardSpec = {
      groups: [
        {
          kind: 'stack',
          prs: [
            { ...QUIET_PR, author: 'viewer', steps: [{ kind: 'review', by: 'other', state: 'CHANGES_REQUESTED' }], tracking: { kind: 'pulled_in' } },
            { ...QUIET_PR, tracking: { kind: 'thread', reason: 'review_requested', readAfter: 0 }, approvedAfter: 0 },
          ],
          snooze: null,
        },
      ],
      writesLocked: false,
      teams: 'one_home',
      teamMembersUnknown: false,
      nowGap: 60,
    };
    const view = tileViewsOf(buildBoard(spec))[0]!;
    const [layer, pinged] = view.prs;
    expect(layer!.provenance.kind).toBe('pulled_in');
    expect(pinged!.done).toBe(true);
    expect(view.state.kind).toBe('unread');
    expect(view.state.unreadBecause.map((reason) => reason.prKey)).toEqual([layer!.key]);
    expect(view.notDonePrKeys).toEqual([layer!.key]);
  });
});

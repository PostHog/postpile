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
  // and no row had a dot. Decided 2026-09-30: the layer gets the dot. Since
  // "GitHub unread is PostPile unread" (same day) the news keeps the tile
  // from being done and makes it loud, but only a thread makes it unread.
  it('loud news on a pulled-in stack layer keeps the tile live and loud, and dots that layer', () => {
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
    expect(view.state).toMatchObject({ kind: 'open', loud: true, unreadOnGitHub: false });
    expect(view.notDonePrKeys).toEqual([layer!.key]);
  });

  // "GitHub unread is PostPile unread": a done PR whose thread turned unread
  // again (a bot, a teammate) holds its set until the thread is read.
  it('a done PR with an unread thread dots its row on a set', () => {
    const spec: BoardSpec = {
      groups: [
        {
          kind: 'set',
          prs: [
            { ...QUIET_PR, end: { kind: 'merged', by: 'other' }, steps: [{ kind: 'review', by: 'viewer', state: 'APPROVED' }, { kind: 'comment', by: 'teammate', text: 'plain', thread: null }], tracking: { kind: 'thread', reason: 'review_requested', readAfter: 1 } },
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
    const [merged] = view.prs;
    expect(merged!.done).toBe(true);
    expect(merged!.unreadOnGitHub).toBe(true);
    expect(view.state).toMatchObject({ kind: 'unread', loud: false });
    expect(view.notDonePrKeys).toEqual([merged!.key]);
  });
});

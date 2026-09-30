// Topic invariants over generated boards (testing/invariants-topic.ts), and
// one scenario per decision the properties led to.
// POSTPILE_PROPERTY_RUNS=10000 pnpm test runs more boards per invariant.
import { describe, expect, it } from 'vitest';
import { buildBoard, checkBoards, PROPERTY_TIMEOUT_MS, QUIET_PR, tileStateOf, TOPIC_INVARIANTS, type BoardSpec } from '../testing/index.ts';

describe('topic invariants', () => {
  for (const invariant of TOPIC_INVARIANTS) {
    it(invariant.name, () => checkBoards(invariant), PROPERTY_TIMEOUT_MS);
  }
});

describe('finished topics, scenarios the properties found', () => {
  // Found 2026-09-29 by "a finished topic with nothing unseen has every
  // tile done": only push and CI snoozes ended on a merged PR, so a "someone
  // replies" or "until" snooze held the finished tile and the topic never
  // retired. Decided 2026-09-30: every snooze ends when its PR is merged or
  // closed.
  for (const condition of ['someone_replies', 'until_time'] as const) {
    it(`a ${condition} snooze on the viewer's merged PR ends, so the tile is done`, () => {
      const spec: BoardSpec = {
        groups: [
          {
            kind: 'single',
            prs: [{ ...QUIET_PR, author: 'viewer', end: { kind: 'merged', by: 'viewer' }, tracking: { kind: 'thread', reason: 'author', readAfter: 1 } }],
            snooze: { condition, after: 0, untilPassed: false },
          },
        ],
        writesLocked: false,
        teamMembersUnknown: false,
        nowGap: 60,
      };
      const board = buildBoard(spec);
      expect(board.snoozes.size).toBe(1);
      expect(tileStateOf(board, board.tiles[0]!).kind).toBe('done');
    });
  }
});

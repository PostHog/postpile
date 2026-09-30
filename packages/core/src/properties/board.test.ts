// The board against the recipe (testing/invariants-board.ts): events, seen
// marks, tiles and snoozes as the recipe says they happened, stated from the
// raw snapshot instead of the rules that built them.
// POSTPILE_PROPERTY_RUNS=10000 pnpm test runs more boards per invariant.
import { describe, it } from 'vitest';
import { BOARD_INVARIANTS, checkBoards, PROPERTY_TIMEOUT_MS } from '../testing/index.ts';

describe('board invariants', () => {
  for (const invariant of BOARD_INVARIANTS) {
    it(invariant.name, () => checkBoards(invariant), PROPERTY_TIMEOUT_MS);
  }
});

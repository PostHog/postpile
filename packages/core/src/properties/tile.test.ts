// Tile invariants over generated boards (testing/invariants-tile.ts).
// POSTPILE_PROPERTY_RUNS=10000 pnpm test runs more boards per invariant.
import { describe, it } from 'vitest';
import { checkBoards, PROPERTY_TIMEOUT_MS, TILE_INVARIANTS } from '../testing/index.ts';

describe('tile invariants', () => {
  for (const invariant of TILE_INVARIANTS) {
    it(invariant.name, () => checkBoards(invariant), PROPERTY_TIMEOUT_MS);
  }
});

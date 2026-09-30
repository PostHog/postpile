// Read invariants over generated boards (testing/invariants-read.ts).
// POSTPILE_PROPERTY_RUNS=10000 pnpm test runs more boards per invariant.
import { describe, it } from 'vitest';
import { checkBoards, PROPERTY_TIMEOUT_MS, READ_INVARIANTS } from '../testing/index.ts';

describe('read invariants', () => {
  for (const invariant of READ_INVARIANTS) {
    it(invariant.name, () => checkBoards(invariant), PROPERTY_TIMEOUT_MS);
  }
});

// What the screen shows over generated boards (testing/invariants-screen.ts):
// groups, unread counts, the NEW pill and the group order, against the spec.
// POSTPILE_PROPERTY_RUNS=10000 pnpm test runs more boards per invariant.
import { describe, it } from 'vitest';
import { checkBoards, PROPERTY_TIMEOUT_MS, SCREEN_INVARIANTS } from '../testing/index.ts';

describe('screen invariants', () => {
  for (const invariant of SCREEN_INVARIANTS) {
    it(invariant.name, () => checkBoards(invariant), PROPERTY_TIMEOUT_MS);
  }
});

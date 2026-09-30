// The rules on one PR against the spec (testing/invariants-rules.ts): the
// answer is worked out from the raw snapshot, never by the rule under test.
// POSTPILE_PROPERTY_RUNS=10000 pnpm test runs more boards per invariant.
import { describe, it } from 'vitest';
import { checkBoards, PROPERTY_TIMEOUT_MS, RULE_INVARIANTS } from '../testing/index.ts';

describe('rule invariants', () => {
  for (const invariant of RULE_INVARIANTS) {
    it(invariant.name, () => checkBoards(invariant), PROPERTY_TIMEOUT_MS);
  }
});

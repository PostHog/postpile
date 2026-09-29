// Topic invariants over generated boards (testing/invariants-topic.ts).
// POSTPILE_PROPERTY_RUNS=10000 pnpm test runs more boards per invariant.
import { describe, it } from 'vitest';
import { checkBoards, PROPERTY_TIMEOUT_MS, TOPIC_INVARIANTS } from '../testing/index.ts';

describe('topic invariants', () => {
  for (const invariant of TOPIC_INVARIANTS) {
    it(invariant.name, () => checkBoards(invariant), PROPERTY_TIMEOUT_MS);
  }
});

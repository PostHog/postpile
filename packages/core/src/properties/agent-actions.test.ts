// Agent-assisted offer invariants over generated boards
// (testing/invariants-agent-actions.ts, oracle testing/spec-agent-actions.ts).
// POSTPILE_PROPERTY_RUNS=10000 pnpm test runs more boards per invariant.
import { describe, it } from 'vitest';
import { AGENT_ACTION_INVARIANTS, checkBoards, PROPERTY_TIMEOUT_MS } from '../testing/index.ts';

describe('agent-assisted offer invariants', () => {
  for (const invariant of AGENT_ACTION_INVARIANTS) {
    it(invariant.name, () => checkBoards(invariant), PROPERTY_TIMEOUT_MS);
  }
});

import { verifyFact, type FactChangeCounts, type PrKey } from '@postpile/core';
import type { Store } from '@postpile/store';
import type { FactWriter } from './fact-writer.ts';
import { verifyWorldFor } from './fact-world.ts';

/**
 * The sync's verify pass: rechecks every active fact touching a fetched PR.
 * Provably over (merged, closed) -> closed now. Untrustworthy -> marked stale,
 * which hides it from prompts and puts it on the topic's recheck list.
 */
export class FactVerifier {
  constructor(
    private readonly store: Store,
    private readonly writer: FactWriter,
    private readonly now: () => Date,
  ) {}

  run(prKeys: PrKey[], counts: FactChangeCounts): void {
    if (prKeys.length === 0) {
      return;
    }
    const at = this.now().toISOString();
    const facts = this.store.facts.listActiveTouchingPrs(prKeys);
    const world = verifyWorldFor(this.store, facts, at);
    this.store.transaction(() => {
      for (const fact of facts) {
        const outcome = verifyFact(fact, world);
        if (outcome.kind === 'invalidate') {
          this.writer.close(fact.id, outcome.reason, outcome.at);
          counts.invalidated += 1;
        } else if (outcome.kind === 'stale' && fact.staleReason !== outcome.reason) {
          this.store.facts.markStale(fact.id, outcome.reason, at);
          counts.stale += 1;
        }
      }
    });
  }
}

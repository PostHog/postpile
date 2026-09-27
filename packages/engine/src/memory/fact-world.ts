import { verifyFact, type Fact, type FactView, type PrKey, type VerifyWorld } from '@code-manager/core';
import type { Store } from '@code-manager/store';

/** Every PR a fact is about or cites. */
export function prKeysOfFact(fact: Fact): PrKey[] {
  const keys = new Set<PrKey>(fact.refs.map((ref) => ref.prKey));
  if (fact.subject.kind === 'pr') {
    keys.add(fact.subject.key);
  }
  if (fact.object?.kind === 'pr') {
    keys.add(fact.object.key);
  }
  return [...keys];
}

/** The stored snapshots verify-before-use needs for these facts. No IO beyond the store. */
export function verifyWorldFor(store: Store, facts: Fact[], now: string, memberKeys: Set<PrKey> = new Set()): VerifyWorld {
  const keys = new Set(facts.flatMap(prKeysOfFact));
  return { prs: store.prs.getMany([...keys]), memberKeys, now };
}

/**
 * Facts checked at read time. Only reads: a failing check shows the fact as
 * stale, the sync's verify pass is what writes it down.
 */
export function factViews(store: Store, facts: Fact[], now: string): FactView[] {
  const world = verifyWorldFor(store, facts, now);
  return facts.map((fact) => {
    const outcome = verifyFact(fact, world);
    const stale = outcome.kind === 'ok' ? fact.staleReason : outcome.reason;
    return { fact, stale };
  });
}

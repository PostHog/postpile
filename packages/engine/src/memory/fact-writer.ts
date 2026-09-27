import type { Fact, FactCandidate, FactChangeCounts, ReconcileAction } from '@code-manager/core';
import type { Store } from '@code-manager/store';
import { newFactId } from '../ids.ts';

export function emptyFactCounts(): FactChangeCounts {
  return { added: 0, updated: 0, invalidated: 0, confirmed: 0, stale: 0 };
}

/**
 * Applies reconcile outcomes to the fact table. Nothing is deleted: an
 * UPDATE closes the old fact and points it at the new one, an INVALIDATE
 * only closes. Callers wrap calls in a transaction.
 */
export class FactWriter {
  constructor(
    private readonly store: Store,
    private readonly now: () => Date,
  ) {}

  private add(candidate: FactCandidate, topicId: string | null): Fact {
    const fact: Fact = {
      id: newFactId(),
      subject: candidate.subject,
      predicate: candidate.predicate,
      object: candidate.object,
      text: candidate.text,
      topicId,
      source: 'agent',
      refs: candidate.refs,
      validFrom: candidate.validFrom,
      invalidAt: null,
      invalidReason: null,
      supersededBy: null,
      recordedAt: this.now().toISOString(),
      expiredAt: null,
      staleAt: null,
      staleReason: null,
      verifiedAt: null,
    };
    this.store.facts.add(fact);
    return fact;
  }

  close(factId: string, reason: string, invalidAt: string, supersededBy: string | null = null): void {
    this.store.facts.close(factId, { invalidAt, reason, supersededBy, expiredAt: this.now().toISOString() });
  }

  apply(action: ReconcileAction, topicId: string | null, counts: FactChangeCounts): void {
    if (action.kind === 'add') {
      this.add(action.candidate, topicId);
      counts.added += 1;
    } else if (action.kind === 'update') {
      const fact = this.add(action.candidate, topicId);
      this.close(action.factId, action.reason, action.candidate.validFrom, fact.id);
      counts.updated += 1;
    } else if (action.kind === 'invalidate') {
      this.close(action.factId, action.reason, action.at);
      counts.invalidated += 1;
    } else {
      this.store.facts.addRefs(action.factId, action.refs, this.now().toISOString());
      counts.confirmed += 1;
    }
  }
}

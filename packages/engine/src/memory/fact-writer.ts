import {
  verifyFact,
  type Fact,
  type FactCandidate,
  type FactChangeCounts,
  type PrKey,
  type ReconcileAction,
  type VerifyOutcome,
} from '@code-manager/core';
import type { Store } from '@code-manager/store';
import { newFactId } from '../ids.ts';
import { verifyWorldFor } from './fact-world.ts';

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

  /** Verify again; a moved head is re-anchored first, since the fact was just confirmed at the current head. */
  private recheck(fact: Fact, at: string): VerifyOutcome {
    const world = verifyWorldFor(this.store, [fact], at);
    const outcome = verifyFact(fact, world);
    if (outcome.kind !== 'stale' || outcome.reason !== 'head_moved') {
      return outcome;
    }
    const heads = new Map<PrKey, string>([...world.prs].map(([key, pr]) => [key, pr.headOid]));
    this.store.facts.reanchorRefs(fact.id, heads);
    const moved = this.store.facts.get(fact.id);
    return moved ? verifyFact(moved, world) : outcome;
  }

  /**
   * The agent says these facts still hold. A stale one whose check keeps
   * failing would go stale again on the next verify pass and be offered for
   * recheck again, so it is closed instead; one that now passes is verified.
   */
  confirm(factIds: string[], counts: FactChangeCounts): void {
    const at = this.now().toISOString();
    for (const fact of this.store.facts.getMany(factIds).values()) {
      const outcome = fact.staleAt === null ? ({ kind: 'ok' } as const) : this.recheck(fact, at);
      if (outcome.kind === 'ok') {
        this.store.facts.markVerified([fact.id], at);
        counts.confirmed += 1;
      } else if (outcome.kind === 'invalidate') {
        this.close(fact.id, outcome.reason, outcome.at);
        counts.invalidated += 1;
      } else {
        this.close(fact.id, `confirmed, but the ${outcome.reason} check still fails`, at);
        counts.invalidated += 1;
      }
    }
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
      this.confirm([action.factId], counts);
    }
  }
}

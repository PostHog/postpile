import type { Fact, FactCandidate, FactPredicate, PreReconcileResult } from './memory.ts';

/**
 * unique: which facts a new one replaces instead of sitting next to.
 * - per_subject: one active fact per subject (an initiative has one status)
 * - per_object: one active fact per object (an initiative has one driver)
 * - none: any number
 * lifecycle: the fact is about an open PR and ends when that PR merges or closes.
 */
export interface PredicateRule {
  unique: 'per_subject' | 'per_object' | 'none';
  lifecycle: boolean;
}

export const PREDICATE_RULES: Record<FactPredicate, PredicateRule> = {
  drives: { unique: 'per_object', lifecycle: false },
  works_on: { unique: 'none', lifecycle: true },
  reviews: { unique: 'none', lifecycle: true },
  owns: { unique: 'none', lifecycle: false },
  part_of: { unique: 'per_subject', lifecycle: false },
  depends_on: { unique: 'none', lifecycle: true },
  blocked_by: { unique: 'none', lifecycle: true },
  decided: { unique: 'none', lifecycle: false },
  status: { unique: 'per_subject', lifecycle: false },
  user_cares: { unique: 'none', lifecycle: false },
  note: { unique: 'none', lifecycle: false },
};

/**
 * The deterministic half of reconciling, so most candidates never need an
 * agent call. `existing` is every active fact on the candidates' subjects.
 * Rules, first match wins:
 * 1. same subject, predicate, object and normalised text -> noop (merge refs)
 * 2. unique predicate, different value, candidate newer -> update
 * 3. same subject, predicate and object, different text -> ambiguous
 * 4. nothing active on subject + predicate -> add
 * 5. anything else -> ambiguous
 */
export function preReconcile(candidates: FactCandidate[], existing: Fact[]): PreReconcileResult {
  throw new Error(`not implemented: preReconcile (${candidates.length} candidates, ${existing.length} facts)`);
}

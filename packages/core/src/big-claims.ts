// Which agent claims earn a "Recheck" button. A recheck is one agent call
// and a decision for the user, so it is kept for claims that change how the
// user sees the work, not for facts GitHub states plainly anyway.
import type { FactPredicate } from './memory.ts';

/**
 * Big: who drives or owns the work (person roles), decisions, blockers
 * (risks), and what the user cares about. Worth checking when wrong.
 */
export const BIG_FACT_PREDICATES: readonly FactPredicate[] = ['drives', 'owns', 'decided', 'blocked_by', 'user_cares'];

/**
 * Trivial: reviewer assignments, who works on what, PR relations (part of,
 * stacked on), status such as CI, and loose notes. GitHub shows these
 * directly; a wrong one fixes itself on the next sync.
 */
export const TRIVIAL_FACT_PREDICATES: readonly FactPredicate[] = ['reviews', 'works_on', 'part_of', 'depends_on', 'status', 'note'];

/** A fact with this predicate gets "Recheck" in the UI. */
export function isBigClaim(predicate: FactPredicate): boolean {
  return BIG_FACT_PREDICATES.includes(predicate);
}

import type { Dossier, DossierIssue, Fact, VerifyOutcome } from './memory.ts';
import type { IsoTime, Pr, PrKey } from './types.ts';

/** What verification may look at. Only stored snapshots: no IO, no agent. */
export interface VerifyWorld {
  prs: Map<PrKey, Pr>;
  /** Current members of the dossier's topic. Only used by verifyDossier. */
  memberKeys: Set<PrKey>;
  now: IsoTime;
}

/**
 * Cheap checks before a fact is shown or fed back into a prompt. In order:
 * 1. a referenced PR is not in the store -> stale pr_missing
 * 2. lifecycle predicate and its PR merged/closed -> invalidate at mergedAt / closed time
 * 3. a ref carries headOid and the PR head moved -> stale head_moved
 * 4. reviews/works_on and the person is no longer reviewer / author / committer -> stale person_not_involved
 * 5. a referenced comment, review or commit is gone from the snapshot -> stale source_deleted
 * 6. otherwise ok
 */
export function verifyFact(fact: Fact, world: VerifyWorld): VerifyOutcome {
  throw new Error(`not implemented: verifyFact (${fact.id}, ${world.prs.size} prs)`);
}

/**
 * The same idea for dossier claims: open questions whose refs point at a
 * resolved review thread or a deleted comment, and timeline entries for PRs
 * that are no longer members. Derived fields (PR state, author) are never
 * stored in the dossier, so they need no check.
 */
export function verifyDossier(dossier: Dossier, world: VerifyWorld): DossierIssue[] {
  throw new Error(`not implemented: verifyDossier (${dossier.timeline.length} entries, ${world.prs.size} prs)`);
}

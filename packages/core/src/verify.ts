import { PREDICATE_RULES } from './fact-rules.ts';
import type { Dossier, DossierIssue, Fact, FactRef, StaleReason, VerifyOutcome } from './memory.ts';
import type { IsoTime, Pr, PrKey } from './types.ts';

/** What verification may look at. Only stored snapshots: no IO, no agent. */
export interface VerifyWorld {
  prs: Map<PrKey, Pr>;
  /** Current members of the dossier's topic. Only used by verifyDossier. */
  memberKeys: Set<PrKey>;
  now: IsoTime;
}

interface PrEnd {
  reason: 'pr_merged' | 'pr_closed';
  at: IsoTime;
}

/** When and how a PR ended, or null while it is open. */
function prEnd(pr: Pr): PrEnd | null {
  if (pr.state === 'MERGED') {
    return { reason: 'pr_merged', at: pr.mergedAt ?? pr.updatedAt };
  }
  if (pr.state === 'CLOSED') {
    const closings = pr.timeline.filter((item) => item.kind === 'closed').map((item) => item.at);
    const lastClosing = closings.sort().at(-1);
    return { reason: 'pr_closed', at: lastClosing ?? pr.updatedAt };
  }
  return null;
}

/** PRs the fact is about: subject and object entities of kind pr. */
function entityPrKeys(fact: Fact): PrKey[] {
  const keys: PrKey[] = [];
  if (fact.subject.kind === 'pr') {
    keys.push(fact.subject.key);
  }
  if (fact.object?.kind === 'pr') {
    keys.push(fact.object.key);
  }
  return keys;
}

function referencedPrKeys(fact: Fact): PrKey[] {
  return [...new Set([...entityPrKeys(fact), ...fact.refs.map((ref) => ref.prKey)])];
}

/** The earliest end among the PRs a lifecycle fact is about. */
function lifecycleEnd(fact: Fact, prs: Map<PrKey, Pr>): PrEnd | null {
  const ends = entityPrKeys(fact)
    .map((key) => prs.get(key))
    .filter((pr): pr is Pr => pr !== undefined)
    .map(prEnd)
    .filter((end): end is PrEnd => end !== null);
  ends.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return ends[0] ?? null;
}

/** A status line about a PR written while it was open says nothing true once it ended. */
function statusOutlivedPr(fact: Fact, prs: Map<PrKey, Pr>): PrEnd | null {
  if (fact.predicate !== 'status' || fact.subject.kind !== 'pr') {
    return null;
  }
  const pr = prs.get(fact.subject.key);
  const end = pr ? prEnd(pr) : null;
  return end !== null && end.at > fact.validFrom ? end : null;
}

function sameLogin(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function isInvolved(fact: Fact, pr: Pr): boolean {
  const login = fact.subject.key;
  if (fact.predicate === 'reviews') {
    return (
      pr.reviewerUsers.some((user) => sameLogin(user, login)) ||
      pr.reviews.some((review) => sameLogin(review.author, login))
    );
  }
  return sameLogin(pr.author, login) || pr.commits.some((commit) => sameLogin(commit.author, login));
}

/** reviews / works_on a PR by a person who no longer shows up on it. */
function personLeft(fact: Fact, prs: Map<PrKey, Pr>): boolean {
  if (fact.predicate !== 'reviews' && fact.predicate !== 'works_on') {
    return false;
  }
  if (fact.subject.kind !== 'person' || fact.object?.kind !== 'pr') {
    return false;
  }
  const pr = prs.get(fact.object.key);
  return pr !== undefined && !isInvolved(fact, pr);
}

function commentExists(pr: Pr, id: string): boolean {
  return (
    pr.comments.some((comment) => comment.id === id) ||
    pr.threads.some((thread) => thread.comments.some((comment) => comment.id === id))
  );
}

/** False when the comment, review or commit a ref points at is gone. Other ref kinds cannot be checked. */
function sourceExists(ref: FactRef, pr: Pr): boolean {
  if (ref.sourceId === null) {
    return true;
  }
  if (ref.kind === 'comment') {
    return commentExists(pr, ref.sourceId);
  }
  if (ref.kind === 'review') {
    return pr.reviews.some((review) => review.id === ref.sourceId);
  }
  if (ref.kind === 'commit') {
    return pr.commits.some((commit) => commit.oid === ref.sourceId);
  }
  return true;
}

/**
 * Cheap checks before a fact is shown or fed back into a prompt. In order:
 * 1. a referenced PR is not in the store -> stale pr_missing
 * 2. lifecycle predicate and its PR merged/closed -> invalidate at mergedAt / closed time
 *    (a status fact about a PR that ended after it was written -> stale pr_merged / pr_closed)
 * 3. a ref carries headOid and the PR head moved -> stale head_moved
 * 4. reviews/works_on and the person is no longer reviewer / author / committer -> stale person_not_involved
 * 5. a referenced comment, review or commit is gone from the snapshot -> stale source_deleted
 * 6. otherwise ok
 */
export function verifyFact(fact: Fact, world: VerifyWorld): VerifyOutcome {
  const { prs } = world;
  if (referencedPrKeys(fact).some((key) => !prs.has(key))) {
    return { kind: 'stale', reason: 'pr_missing' };
  }

  if (PREDICATE_RULES[fact.predicate].lifecycle) {
    const end = lifecycleEnd(fact, prs);
    if (end !== null) {
      return { kind: 'invalidate', reason: end.reason, at: end.at };
    }
  }
  const outlived = statusOutlivedPr(fact, prs);
  if (outlived !== null) {
    return { kind: 'stale', reason: outlived.reason };
  }

  const headMoved = fact.refs.some((ref) => ref.headOid !== null && prs.get(ref.prKey)?.headOid !== ref.headOid);
  if (headMoved) {
    return { kind: 'stale', reason: 'head_moved' };
  }

  if (personLeft(fact, prs)) {
    return { kind: 'stale', reason: 'person_not_involved' };
  }

  const sourceGone = fact.refs.some((ref) => {
    const pr = prs.get(ref.prKey);
    return pr !== undefined && !sourceExists(ref, pr);
  });
  if (sourceGone) {
    return { kind: 'stale', reason: 'source_deleted' };
  }

  return { kind: 'ok' };
}

/** Why a question's ref no longer holds, or null. */
function questionRefIssue(ref: FactRef, prs: Map<PrKey, Pr>): StaleReason | null {
  const pr = prs.get(ref.prKey);
  if (pr === undefined) {
    return 'pr_missing';
  }
  if (!sourceExists(ref, pr)) {
    return 'source_deleted';
  }
  if (ref.kind === 'comment' && ref.sourceId !== null) {
    const thread = pr.threads.find((candidate) => candidate.comments.some((comment) => comment.id === ref.sourceId));
    if (thread?.isResolved) {
      return 'thread_resolved';
    }
  }
  return null;
}

/**
 * The same idea for dossier claims: open questions whose refs point at a
 * resolved review thread or a deleted comment, and timeline entries for PRs
 * that are no longer members. Derived fields (PR state, author) are never
 * stored in the dossier, so they need no check.
 */
export function verifyDossier(dossier: Dossier, world: VerifyWorld): DossierIssue[] {
  const issues: DossierIssue[] = [];
  dossier.openQuestions.forEach((question, index) => {
    for (const ref of question.refs) {
      const reason = questionRefIssue(ref, world.prs);
      if (reason !== null) {
        issues.push({ path: `openQuestions[${index}]`, reason });
        break;
      }
    }
  });
  dossier.timeline.forEach((entry, index) => {
    if (!world.memberKeys.has(entry.prKey)) {
      issues.push({ path: `timeline[${index}]`, reason: 'left_topic' });
    }
  });
  return issues;
}

import type {
  AmbiguousCandidate,
  EntityRef,
  Fact,
  FactCandidate,
  FactPredicate,
  FactRef,
  PreReconcileResult,
  ReconcileAction,
} from './memory.ts';

/**
 * unique: which facts a new one replaces instead of sitting next to.
 * - per_subject: one active fact per subject (an initiative has one status)
 * - per_object: one active fact per object (an initiative has one driver)
 * - none: any number
 * lifecycle: the fact is about an open PR and ends when that PR merges or closes.
 * followsHead: the fact depends on the code as it was, so a push that moves
 * a ref's head makes it stale. Who drives or owns something does not.
 */
export interface PredicateRule {
  unique: 'per_subject' | 'per_object' | 'none';
  lifecycle: boolean;
  followsHead: boolean;
}

export const PREDICATE_RULES: Record<FactPredicate, PredicateRule> = {
  drives: { unique: 'per_object', lifecycle: false, followsHead: false },
  works_on: { unique: 'none', lifecycle: true, followsHead: false },
  reviews: { unique: 'none', lifecycle: true, followsHead: false },
  owns: { unique: 'none', lifecycle: false, followsHead: false },
  part_of: { unique: 'per_subject', lifecycle: false, followsHead: false },
  depends_on: { unique: 'none', lifecycle: true, followsHead: true },
  blocked_by: { unique: 'none', lifecycle: true, followsHead: true },
  decided: { unique: 'none', lifecycle: false, followsHead: true },
  status: { unique: 'per_subject', lifecycle: false, followsHead: true },
  user_cares: { unique: 'none', lifecycle: false, followsHead: false },
  note: { unique: 'none', lifecycle: false, followsHead: false },
};

export function sameEntity(a: EntityRef | null, b: EntityRef | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.kind === b.kind && a.key === b.key;
}

/** Lowercase, single spaces, no trailing punctuation: "Alice drives it." equals "alice  drives it". */
export function normaliseFactText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?;,]+$/, '');
}

function refKey(ref: FactRef): string {
  return `${ref.kind}|${ref.prKey}|${ref.sourceId ?? ''}`;
}

/** Refs of both lists, first occurrence wins. */
export function mergeRefs(a: FactRef[], b: FactRef[]): FactRef[] {
  const seen = new Set<string>();
  const merged: FactRef[] = [];
  for (const ref of [...a, ...b]) {
    if (!seen.has(refKey(ref))) {
      seen.add(refKey(ref));
      merged.push(ref);
    }
  }
  return merged;
}

function candidateKey(candidate: FactCandidate): string {
  const object = candidate.object ? `${candidate.object.kind}:${candidate.object.key}` : '-';
  const subject = `${candidate.subject.kind}:${candidate.subject.key}`;
  return `${subject}|${candidate.predicate}|${object}|${normaliseFactText(candidate.text)}`;
}

/** The same statement twice in one answer becomes one candidate with both sets of refs. */
function dedupeCandidates(candidates: FactCandidate[]): FactCandidate[] {
  const byKey = new Map<string, FactCandidate>();
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    const known = byKey.get(key);
    if (known === undefined) {
      byKey.set(key, candidate);
      continue;
    }
    byKey.set(key, {
      ...known,
      refs: mergeRefs(known.refs, candidate.refs),
      validFrom: known.validFrom < candidate.validFrom ? known.validFrom : candidate.validFrom,
    });
  }
  return [...byKey.values()];
}

/** The unique slot a candidate fills, or null for predicates any number of facts may share. */
function slotKey(candidate: FactCandidate): string | null {
  const rule = PREDICATE_RULES[candidate.predicate].unique;
  if (rule === 'per_subject') {
    return `${candidate.predicate}|subject|${candidate.subject.kind}:${candidate.subject.key}`;
  }
  if (rule === 'per_object' && candidate.object !== null) {
    return `${candidate.predicate}|object|${candidate.object.kind}:${candidate.object.key}`;
  }
  return null;
}

/**
 * One answer can fill the same unique slot twice, e.g. a handover inside one
 * delta. Each candidate would be checked against the stored facts only, so
 * both would end up active. Only the newest per slot is kept; on a tie the
 * later one in the answer wins.
 */
function newestPerSlot(candidates: FactCandidate[]): FactCandidate[] {
  const newest = new Map<string, FactCandidate>();
  for (const candidate of candidates) {
    const key = slotKey(candidate);
    const known = key === null ? undefined : newest.get(key);
    if (key !== null && (known === undefined || candidate.validFrom >= known.validFrom)) {
      newest.set(key, candidate);
    }
  }
  return candidates.filter((candidate) => {
    const key = slotKey(candidate);
    return key === null || newest.get(key) === candidate;
  });
}

function isExactMatch(fact: Fact, candidate: FactCandidate): boolean {
  return (
    sameEntity(fact.subject, candidate.subject) &&
    fact.predicate === candidate.predicate &&
    sameEntity(fact.object, candidate.object) &&
    normaliseFactText(fact.text) === normaliseFactText(candidate.text)
  );
}

/** Facts sitting in the one slot a unique predicate allows. Empty for predicates without a slot. */
function uniqueSlot(candidate: FactCandidate, existing: Fact[]): Fact[] {
  const rule = PREDICATE_RULES[candidate.predicate].unique;
  const samePredicate = existing.filter((fact) => fact.predicate === candidate.predicate);
  if (rule === 'per_subject') {
    return samePredicate.filter((fact) => sameEntity(fact.subject, candidate.subject));
  }
  if (rule === 'per_object' && candidate.object !== null) {
    return samePredicate.filter((fact) => sameEntity(fact.object, candidate.object));
  }
  return [];
}

function newestFirst(facts: Fact[]): Fact[] {
  return [...facts].sort((a, b) => (a.validFrom < b.validFrom ? 1 : a.validFrom > b.validFrom ? -1 : 0));
}

/**
 * Rule 2: the candidate takes over a unique slot. The newest occupant is
 * updated (superseded); any older leftovers are invalidated. Null when some
 * occupant is not older than the candidate: then a model has to decide.
 */
function replaceSlot(candidate: FactCandidate, slot: Fact[]): ReconcileAction[] | null {
  const [newest, ...older] = newestFirst(slot);
  if (newest === undefined || slot.some((fact) => fact.validFrom >= candidate.validFrom)) {
    return null;
  }
  const reason = `replaced by a newer ${candidate.predicate} fact`;
  const actions: ReconcileAction[] = [{ kind: 'update', factId: newest.id, candidate, reason }];
  for (const fact of older) {
    actions.push({ kind: 'invalidate', factId: fact.id, reason, at: candidate.validFrom });
  }
  return actions;
}

/**
 * The deterministic half of reconciling, so most candidates never need an
 * agent call. `existing` is every active fact on the candidates' subjects and
 * objects (objects matter for per_object predicates like drives). Candidates
 * are deduped first, and only the newest per unique slot is kept.
 * Rules, first match wins:
 * 1. same subject, predicate, object and normalised text -> noop (merge refs)
 * 2. unique predicate, different value, candidate newer -> update
 * 3. same subject, predicate and object, different text -> ambiguous
 * 4. nothing in the way -> add. "In the way" is an occupant of a unique slot;
 *    for other predicates a different object is simply another fact
 *    (alice works on #1 and on #2), so it needs no agent call.
 * 5. anything else (a unique slot held by a newer fact) -> ambiguous
 */
export function preReconcile(candidates: FactCandidate[], existing: Fact[]): PreReconcileResult {
  const actions: ReconcileAction[] = [];
  const ambiguous: AmbiguousCandidate[] = [];
  for (const candidate of newestPerSlot(dedupeCandidates(candidates))) {
    const sameSubjectPredicate = existing.filter(
      (fact) => fact.predicate === candidate.predicate && sameEntity(fact.subject, candidate.subject),
    );

    const match = sameSubjectPredicate.find((fact) => isExactMatch(fact, candidate));
    if (match !== undefined) {
      actions.push({ kind: 'noop', factId: match.id, refs: candidate.refs });
      continue;
    }

    const replaced = replaceSlot(candidate, uniqueSlot(candidate, existing));
    if (replaced !== null) {
      actions.push(...replaced);
      continue;
    }

    const sameObject = sameSubjectPredicate.filter((fact) => sameEntity(fact.object, candidate.object));
    if (sameObject.length > 0) {
      ambiguous.push({ candidate, existing: sameObject });
      continue;
    }

    const slot = uniqueSlot(candidate, existing);
    if (slot.length === 0) {
      actions.push({ kind: 'add', candidate });
      continue;
    }

    ambiguous.push({ candidate, existing: slot });
  }
  return { actions, ambiguous };
}

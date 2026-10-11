import { at, makeFact, makeFactRef } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness, NOW } from '../testing/fakes.ts';
import { reviewRequestedPr } from '../testing/prs.ts';
import { emptyFactCounts, FactWriter } from './fact-writer.ts';

/** bob "reviews" #1, but #1 has no request or review from bob: the person_not_involved check fails. */
function withBobFact(staleAt: string | null) {
  const h = makeHarness();
  const pr = reviewRequestedPr(1);
  h.store.prs.upsert(pr, at(0));
  const fact = makeFact({
    id: 'f1',
    subject: { kind: 'person', key: 'bob' },
    predicate: 'reviews',
    text: 'bob reviews #1',
    refs: [makeFactRef({ prKey: pr.key })],
    staleAt,
    staleReason: staleAt === null ? null : 'person_not_involved',
  });
  h.store.facts.add(fact);
  return { h, pr, writer: new FactWriter(h.store, () => NOW) };
}

describe('FactWriter noop', () => {
  // PR #181 review: addRefs stamped verifiedAt before the check, so the "Keep it" waiver passed and revived the fact.
  it('closes a repeated stale fact whose check still fails instead of reviving it', () => {
    const { h, pr, writer } = withBobFact(at(5));
    const counts = emptyFactCounts();
    writer.apply({ kind: 'noop', factId: 'f1', refs: [makeFactRef({ prKey: pr.key, kind: 'comment', sourceId: null, at: at(10) })] }, null, counts);
    expect(h.store.facts.get('f1')).toMatchObject({ verifiedAt: null, invalidReason: 'confirmed, but the person_not_involved check still fails' });
    expect(h.store.facts.listActiveTouchingPrs([pr.key])).toEqual([]);
    expect(counts).toMatchObject({ confirmed: 0, invalidated: 1 });
  });

  it('checks a fact not yet marked stale too, and only verifies one that passes', () => {
    const failing = withBobFact(null);
    failing.writer.apply({ kind: 'noop', factId: 'f1', refs: [] }, null, emptyFactCounts());
    expect(failing.h.store.facts.get('f1')?.verifiedAt).toBeNull();
    expect(failing.h.store.facts.listActiveTouchingPrs([failing.pr.key])).toEqual([]);

    const { h, pr, writer } = withBobFact(null);
    h.store.prs.upsert({ ...pr, reviewerUsers: ['bob'] }, at(0));
    writer.apply({ kind: 'noop', factId: 'f1', refs: [] }, null, emptyFactCounts());
    expect(h.store.facts.get('f1')).toMatchObject({ verifiedAt: NOW.toISOString(), invalidAt: null });
  });
});

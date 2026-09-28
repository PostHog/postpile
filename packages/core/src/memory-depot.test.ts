// Engine memory rules on the "Move CI to Depot" example: verify-before-use and
// reconcile when the world moves under a stored fact.

import { describe, expect, it } from 'vitest';
import { preReconcile } from './fact-rules.ts';
import { at, makeCandidate, makeCommit, makeFact, makeFactRef, makePr, makeReview, viewer } from './fixtures.ts';
import type { Fact } from './memory.ts';
import type { Pr } from './types.ts';
import { verifyFact, type VerifyWorld } from './verify.ts';

function world(prs: Pr[]): VerifyWorld {
  return { prs: new Map(prs.map((pr) => [pr.key, pr])), memberKeys: new Set(prs.map((pr) => pr.key)), now: at(1000) };
}

const approvedPr = makePr({
  number: 1902,
  title: 'chore(ci): move docker builds to depot',
  headOid: 'c1',
  commits: [makeCommit({ oid: 'c1', committedAt: at(1) })],
  reviews: [makeReview({ id: 'r1', author: viewer.login, commitOid: 'c1', submittedAt: at(5) })],
});

const aliceApproved: Fact = makeFact({
  id: 'approved-1902',
  subject: { kind: 'pr', key: approvedPr.key },
  predicate: 'status',
  object: null,
  text: `Alice approved ${approvedPr.key}`,
  refs: [makeFactRef({ kind: 'review', prKey: approvedPr.key, sourceId: 'r1', at: at(5), headOid: 'c1' })],
  validFrom: at(5),
});

const pushedAfterApproval: Pr = {
  ...approvedPr,
  headOid: 'c2',
  commits: [...approvedPr.commits, makeCommit({ oid: 'c2', headline: 'bump runner size', committedAt: at(20) })],
};

describe('Depot memory examples', () => {
  it('"Alice approved #1902" holds while the head is unchanged', () => {
    expect(verifyFact(aliceApproved, world([approvedPr]))).toEqual({ kind: 'ok' });
  });

  it('a push on #1902 after approval makes the approval fact stale at once', () => {
    expect(verifyFact(aliceApproved, world([pushedAfterApproval]))).toEqual({ kind: 'stale', reason: 'head_moved' });
  });

  it('the next dossier update invalidates it: the new status supersedes the approval', () => {
    const candidate = makeCandidate({
      subject: { kind: 'pr', key: approvedPr.key },
      predicate: 'status',
      object: null,
      text: `new commits on ${approvedPr.key} after Alice's approval`,
      refs: [makeFactRef({ kind: 'commit', prKey: approvedPr.key, sourceId: 'c2', at: at(20), headOid: 'c2' })],
      validFrom: at(20),
    });
    const { actions, ambiguous } = preReconcile([candidate], [aliceApproved]);
    expect(ambiguous).toEqual([]);
    expect(actions).toEqual([
      { kind: 'update', factId: 'approved-1902', candidate, reason: 'replaced by a newer status fact' },
    ]);
  });

  it('a fact whose PR closed is caught by verify', () => {
    const closed: Pr = { ...approvedPr, state: 'CLOSED', updatedAt: at(40) };
    expect(verifyFact(aliceApproved, world([closed]))).toEqual({ kind: 'stale', reason: 'pr_closed' });

    const aliceWorksOn = makeFact({ object: { kind: 'pr', key: approvedPr.key }, refs: [makeFactRef({ prKey: approvedPr.key })] });
    expect(verifyFact(aliceWorksOn, world([closed]))).toEqual({ kind: 'invalidate', reason: 'pr_closed', at: at(40) });
  });
});

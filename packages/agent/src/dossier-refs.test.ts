import { describe, expect, it } from 'vitest';
import { eventRef } from './dossier-refs.ts';
import { makeEvent, makePr } from './test-fixtures.ts';

describe('eventRef', () => {
  const review = { id: 'r1', author: 'bob', state: 'APPROVED' as const, body: '', submittedAt: '2026-09-02T09:00:00Z', commitOid: 'old' };
  const pr = makePr({ headOid: 'new', reviews: [review] });

  it('pins the head a claim was made against', () => {
    expect(eventRef(makeEvent({ kind: 'review_approved', sourceId: 'r1' }), pr).headOid).toBe('old');
    expect(eventRef(makeEvent({ kind: 'commits_pushed', sourceId: 'c0ffee' }), pr).headOid).toBe('c0ffee');
    expect(eventRef(makeEvent({ kind: 'comment', sourceId: 'c1' }), pr).headOid).toBe('new');
  });

  it('pins nothing once the PR is over or unknown', () => {
    const merged = { ...pr, state: 'MERGED' as const };
    expect(eventRef(makeEvent({ kind: 'comment' }), merged).headOid).toBeNull();
    expect(eventRef(makeEvent({ kind: 'comment' }), undefined).headOid).toBeNull();
  });
});

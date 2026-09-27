import { describe, expect, it } from 'vitest';
import type { Review } from '@code-manager/core';
import { at, makePr } from '@code-manager/core/fixtures';
import { checkCounts, mergeStatus, reviewRows, statusParts } from './pr.ts';

function review(author: string, state: Review['state'], minutes: number): Review {
  return { id: `${author}-${minutes}`, author, state, body: '', submittedAt: at(minutes), commitOid: null };
}

describe('pr helpers', () => {
  it('lists pending requests first, then newest reviews, teams last', () => {
    const pr = makePr({
      reviewerUsers: ['viewer'],
      reviewerTeams: ['PostHog/team-devex'],
      reviews: [review('lyra', 'APPROVED', 10), review('lyra', 'COMMENTED', 20), review('nell', 'COMMENTED', 15)],
    });
    expect(reviewRows(pr)).toEqual([
      { login: 'viewer', status: 'requested', at: null },
      { login: 'nell', status: 'commented', at: at(15) },
      { login: 'lyra', status: 'approved', at: at(10) },
      { login: 'PostHog/team-devex', status: 'requested', at: null },
    ]);
  });

  it('lets a later change request replace an approval', () => {
    const pr = makePr({ reviews: [review('lyra', 'APPROVED', 10), review('lyra', 'CHANGES_REQUESTED', 20)] });
    expect(reviewRows(pr)).toEqual([{ login: 'lyra', status: 'changes_requested', at: at(20) }]);
  });

  it('counts checks by conclusion', () => {
    const counts = checkCounts({
      rollup: 'PENDING',
      contexts: [
        { name: 'a', conclusion: 'SUCCESS', completedAt: null },
        { name: 'b', conclusion: 'SKIPPED', completedAt: null },
        { name: 'c', conclusion: 'FAILURE', completedAt: null },
        { name: 'd', conclusion: null, completedAt: null },
      ],
    });
    expect(counts).toEqual({ ok: 2, failed: 1, pending: 1, total: 4 });
  });

  it('describes the merge status', () => {
    expect(mergeStatus(makePr({ state: 'MERGED', mergedBy: 'rowan' }))).toBe('merged by rowan');
    expect(mergeStatus(makePr())).toBe('needs review');
  });
});

describe('statusParts', () => {
  it('lists lifecycle, review and checks and leaves out what does not apply', () => {
    expect(statusParts({ lifecycle: 'open', review: 'approved', checks: 'fail' }).map((part) => [part.text, part.tone])).toEqual([
      ['open', 'good'],
      ['approved', 'good'],
      ['ci ✗', 'bad'],
    ]);
    expect(statusParts({ lifecycle: 'merged', review: null, checks: null }).map((part) => part.text)).toEqual(['merged']);
    expect(statusParts({ lifecycle: 'queued', review: 'changes', checks: 'pending' }).map((part) => part.tone)).toEqual([
      'queued',
      'bad',
      'neutral',
    ]);
  });
});

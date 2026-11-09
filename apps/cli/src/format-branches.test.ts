import { describe, expect, it } from 'vitest';
import type { BranchEntry } from '@postpile/core';
import { formatBranches } from './format-branches.ts';

function entry(overrides: Partial<BranchEntry>): BranchEntry {
  return {
    key: 'acme/app#1',
    repo: 'acme/app',
    number: 1,
    url: 'https://github.com/acme/app/pull/1',
    headRef: 'feat/x',
    baseRef: 'main',
    headOid: 'abc',
    state: 'open',
    draft: false,
    mergedAt: null,
    closedAt: null,
    author: 'alice',
    role: 'author',
    whoseMove: { kind: 'you', move: 'merge', who: null, what: 'Merge, it is approved' },
    fetchedAt: null,
    untrusted: { title: 'Add a flag' },
    signals: { feedback: null, readyToLand: true, ended: null, pushesSinceYourReview: null, repliesSinceYourReview: null },
    ...overrides,
  };
}

describe('formatBranches', () => {
  it('prints one line per PR with its signals', () => {
    const reviewed = entry({
      key: 'acme/app#2',
      role: 'reviewer',
      headRef: 'fix/y',
      whoseMove: { kind: 'them', move: null, who: 'bob', what: 'to merge' },
      signals: {
        feedback: null,
        readyToLand: false,
        ended: null,
        pushesSinceYourReview: { reviewedAt: '2026-09-01T00:00:00Z', reviewState: 'APPROVED', reviewCommitOid: 'a', commitsSince: 2 },
        repliesSinceYourReview: { since: '2026-09-01T00:00:00Z', count: 1 },
      },
    });
    expect(formatBranches({ generatedAt: '', viewer: 'alice', prs: [entry({}), reviewed] }).split('\n')).toEqual([
      'acme/app#1  author  open  feat/x  you: merge  [ready to land]  Add a flag',
      'acme/app#2  reviewer  open  fix/y  them: bob  [+2 commits since your review; 1 reply since you spoke]  Add a flag',
    ]);
  });

  it('says when there is nothing', () => {
    expect(formatBranches({ generatedAt: '', viewer: 'alice', prs: [] })).toBe('no own or reviewed PRs for @alice in this window');
  });
});

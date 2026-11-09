import { at, makePr, makeReview } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { DISCUSSION_READY_KEY, Store } from './index.ts';

function storeWithPrs(): Store {
  const store = Store.open(':memory:');
  store.prs.upsert(makePr({ number: 1, author: 'Alice' }), at(1));
  store.prs.upsert(makePr({ number: 2, author: 'bob', reviews: [makeReview({ author: 'alice', state: 'COMMENTED' })] }), at(1));
  store.prs.upsert(makePr({ number: 3, author: 'renovate[bot]', assignees: ['alice'] }), at(1));
  store.prs.upsert(makePr({ number: 4, author: 'bob' }), at(1));
  store.prs.upsert(makePr({ number: 5, author: 'alice', state: 'MERGED', updatedAt: at(10), mergedAt: at(10) }), at(1));
  store.prs.upsert(makePr({ number: 6, repo: 'acme/web', author: 'alice' }), at(1));
  return store;
}

describe('PrRepo.branchCandidateKeys', () => {
  it('keeps open and recently updated PRs the login wrote, is assigned to or reviewed', () => {
    const store = storeWithPrs();
    store.meta.set(DISCUSSION_READY_KEY, at(40));
    expect(store.prs.branchCandidateKeys('alice', at(20), null).sort()).toEqual(['acme/app#1', 'acme/app#2', 'acme/app#3', 'acme/web#6']);
    expect(store.prs.branchCandidateKeys('alice', at(5), 'ACME/app').sort()).toEqual(['acme/app#1', 'acme/app#2', 'acme/app#3', 'acme/app#5']);
  });

  it('keeps every PR in the window before the review rows are switched on', () => {
    expect(storeWithPrs().prs.branchCandidateKeys('alice', at(20), 'acme/app')).toHaveLength(4);
  });
});

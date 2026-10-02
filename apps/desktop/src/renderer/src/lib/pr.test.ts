import { describe, expect, it } from 'vitest';
import type { PrStatus, Review } from '@postpile/core';
import { at, makePr } from '@postpile/core/fixtures';
import { approvedText, checkCounts, checksNote, ICON_WORDS, mergeQueueWord, mergeStatus, reviewRows, reviewWord, rowStateWord, stackQueueWord } from './pr.ts';

function review(author: string, state: Review['state'], minutes: number): Review {
  return { id: `${author}-${minutes}`, author, state, body: '', submittedAt: at(minutes), commitOid: null };
}

describe('pr helpers', () => {
  it('lists pending requests first, then newest reviews, teams last', () => {
    const pr = makePr({
      reviewerUsers: ['viewer'],
      reviewerTeams: ['acme/team-platform'],
      reviews: [review('lyra', 'APPROVED', 10), review('lyra', 'COMMENTED', 20), review('nell', 'COMMENTED', 15)],
    });
    expect(reviewRows(pr)).toEqual([
      { login: 'viewer', status: 'requested', at: null },
      { login: 'nell', status: 'commented', at: at(15) },
      { login: 'lyra', status: 'approved', at: at(10) },
      { login: 'acme/team-platform', status: 'requested', at: null },
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

  it('words checks neutrally, failed and running together as not passing', () => {
    expect(checksNote({ ok: 2, failed: 1, pending: 1, total: 4 })).toBe('4 checks · 2 not passing');
    expect(checksNote({ ok: 3, failed: 0, pending: 0, total: 3 })).toBe('3 checks · all passing');
    expect(checksNote({ ok: 1, failed: 0, pending: 0, total: 1 })).toBe('1 check · all passing');
  });

  it('describes the merge status', () => {
    expect(mergeStatus(makePr({ state: 'MERGED', mergedBy: 'rowan' }), [])).toBe('merged by rowan');
    expect(mergeStatus(makePr(), [])).toBe('needs review');
  });

  it('says who approved when only an agent did', () => {
    const approved = makePr({ reviewDecision: 'APPROVED' });
    expect(mergeStatus(approved, ['reviewbot'])).toBe('approved by reviewbot (agent)');
    expect(mergeStatus(approved, [])).toBe('approved');
  });

  it('names agents in words', () => {
    expect(approvedText([])).toBe('approved');
    expect(approvedText(['reviewbot'])).toBe('approved by reviewbot (agent)');
    expect(approvedText(['reviewbot', 'lintbot', 'docbot'])).toBe('approved by reviewbot, lintbot and docbot (agents)');
  });
});

describe('state words', () => {
  const open: PrStatus = { lifecycle: 'open', review: null, agentApprovers: [], mergeQueue: null, icon: 'open' };

  it('says the review state in words, never CI', () => {
    expect(reviewWord({ ...open, review: 'review' })).toEqual({ kind: 'review', text: 'Needs review', title: 'Review required' });
    expect(reviewWord({ ...open, review: 'approved' })?.text).toBe('Approved');
    expect(reviewWord({ ...open, review: 'changes' })?.text).toBe('Changes requested');
    expect(reviewWord(open)).toBeNull();
  });

  it('says "approved by agent" when only agents approved, names in the tooltip', () => {
    expect(reviewWord({ ...open, review: 'approved', agentApprovers: ['reviewbot'] })).toEqual({
      kind: 'approved',
      text: 'Approved by agent',
      title: 'Approved by reviewbot (agent)',
    });
    expect(reviewWord({ ...open, review: 'approved', agentApprovers: ['reviewbot', 'lintbot'] })?.text).toBe('Approved by agents');
  });

  it('puts merged, closed and draft in place of the review on a row', () => {
    const now = new Date(at(60));
    expect(rowStateWord({ ...open, lifecycle: 'merged', icon: 'merged' }, now)?.text).toBe('Merged');
    expect(rowStateWord({ ...open, lifecycle: 'closed', icon: 'closed' }, now)?.kind).toBe('closed');
    expect(rowStateWord({ ...open, lifecycle: 'draft', review: 'approved', icon: 'draft' }, now)?.kind).toBe('draft');
    expect(rowStateWord({ ...open, review: 'approved' }, now)?.text).toBe('Approved');
  });

  it('names every state icon', () => {
    expect(ICON_WORDS.open.text).toBe('Open');
    expect(ICON_WORDS.merge_queue.title).toBe('In the merge queue');
  });
});

describe('merge queue words', () => {
  const open: PrStatus = { lifecycle: 'open', review: 'approved', agentApprovers: [], mergeQueue: null, icon: 'open' };
  const now = new Date(at(60));
  const clock = (minutes: number) => {
    const date = new Date(at(minutes));
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  };

  it('puts where the PR stands in the queue in place of the review, since when in the tooltip', () => {
    const testing: PrStatus = { ...open, icon: 'merge_queue', mergeQueue: { state: 'testing', since: at(28), reason: null, testingOn: 'acme/app#1205' } };
    expect(rowStateWord(testing, now)).toEqual({ kind: 'merge_queue', text: 'Merge queue: Testing', title: `In the merge queue, testing on #1205 since ${clock(28)}` });
    const submitted: PrStatus = { ...testing, mergeQueue: { state: 'submitted', since: at(28), reason: null, testingOn: null } };
    expect(rowStateWord(submitted, now)?.text).toBe('Merge queue: Submitted');
    // GitHub's own queue says no step.
    expect(rowStateWord({ ...open, lifecycle: 'queued', icon: 'merge_queue' }, now)?.text).toBe('Merge queue');
  });

  it('says failed in red, the reason in the tooltip, and in the long form', () => {
    const failed: PrStatus = { ...open, icon: 'merge_queue_failed', mergeQueue: { state: 'failed', since: at(28), reason: 'tests failed', testingOn: null } };
    expect(rowStateWord(failed, now)).toMatchObject({ kind: 'merge_queue_failed', text: 'Merge queue: Failed' });
    expect(rowStateWord(failed, now)?.title).toContain(': tests failed');
    expect(mergeQueueWord(failed, now, true)?.text).toBe('Merge queue: Failed (tests failed)');
    expect(mergeQueueWord(open, now)).toBeNull();
  });
});

describe('stack queue word', () => {
  const open: PrStatus = { lifecycle: 'open', review: 'approved', agentApprovers: [], mergeQueue: null, icon: 'open' };
  const queued: PrStatus = { ...open, icon: 'merge_queue', mergeQueue: { state: 'submitted', since: at(28), reason: null, testingOn: null } };
  const failed: PrStatus = { ...open, icon: 'merge_queue_failed', mergeQueue: { state: 'failed', since: at(28), reason: 'tests failed', testingOn: null } };
  const stacks = [{ id: 'stack:acme/app#1861', prKeys: ['acme/app#1861', 'acme/app#1862', 'acme/app#1863'] }];
  const now = new Date(at(60));
  const layers = (a: PrStatus, b: PrStatus, c: PrStatus) => [
    { key: 'acme/app#1861', status: a },
    { key: 'acme/app#1862', status: b },
    { key: 'acme/app#1863', status: c },
  ];

  it('labels the layers below a queued layer, nothing else', () => {
    const word = stackQueueWord('acme/app#1861', layers(open, open, queued), stacks, now);
    expect(word).toMatchObject({ kind: 'merge_queue', text: 'Merge queue: with 3/3' });
    expect(word?.title).toContain('Merges with #1863, which is in the merge queue (Submitted to the merge queue');
    // The lowest queued layer above wins.
    expect(stackQueueWord('acme/app#1861', layers(open, queued, queued), stacks, now)?.text).toBe('Merge queue: with 2/3');
    // The queue took the top layer out: back to the normal word.
    expect(stackQueueWord('acme/app#1861', layers(open, open, failed), stacks, now)).toBeNull();
    // A queued layer below this one does not take it along, and the queued layer keeps its own word.
    expect(stackQueueWord('acme/app#1863', layers(queued, open, open), stacks, now)).toBeNull();
    expect(stackQueueWord('acme/app#1863', layers(open, open, queued), stacks, now)).toBeNull();
    // Drafts and merged layers keep their word.
    expect(stackQueueWord('acme/app#1861', layers({ ...open, lifecycle: 'draft', icon: 'draft' }, open, queued), stacks, now)).toBeNull();
    expect(stackQueueWord('acme/app#1861', layers({ ...open, lifecycle: 'merged', icon: 'merged' }, open, queued), stacks, now)).toBeNull();
  });
});

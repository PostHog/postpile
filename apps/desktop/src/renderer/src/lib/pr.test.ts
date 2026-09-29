import { describe, expect, it } from 'vitest';
import type { PrStatus, Review } from '@postpile/core';
import { at, makePr } from '@postpile/core/fixtures';
import { approvedText, checkCounts, checksNote, LIFECYCLE_WORDS, mergeStatus, reviewRows, reviewWord, rowStateWord } from './pr.ts';

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
  const open: PrStatus = { lifecycle: 'open', review: null, checks: 'fail', agentApprovers: [] };

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
    expect(rowStateWord({ ...open, lifecycle: 'merged' })?.text).toBe('Merged');
    expect(rowStateWord({ ...open, lifecycle: 'closed' })?.kind).toBe('closed');
    expect(rowStateWord({ ...open, lifecycle: 'draft', review: 'approved' })?.kind).toBe('draft');
    expect(rowStateWord({ ...open, lifecycle: 'queued', review: 'approved' })?.text).toBe('Approved');
  });

  it('names every lifecycle', () => {
    expect(LIFECYCLE_WORDS.open.text).toBe('Open');
    expect(LIFECYCLE_WORDS.queued.title).toBe('In the merge queue');
  });
});

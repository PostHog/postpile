import { describe, expect, it } from 'vitest';
import type { Review } from '@postpile/core';
import { at, makePr } from '@postpile/core/fixtures';
import { approvedText, checkCounts, mergeStatus, reviewRows, statusParts } from './pr.ts';

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

describe('statusParts', () => {
  it('lists lifecycle, review and checks and leaves out what does not apply', () => {
    expect(statusParts({ lifecycle: 'open', review: 'approved', checks: 'fail', agentApprovers: [] }).map((part) => [part.text, part.tone])).toEqual([
      ['open', 'good'],
      ['approved', 'good'],
      ['ci ✗', 'bad'],
    ]);
    expect(statusParts({ lifecycle: 'merged', review: null, checks: null, agentApprovers: [] }).map((part) => part.text)).toEqual(['merged']);
    expect(statusParts({ lifecycle: 'queued', review: 'changes', checks: 'pending', agentApprovers: [] }).map((part) => part.tone)).toEqual([
      'queued',
      'bad',
      'neutral',
    ]);
  });

  it('says "approved by agent" in the same calm tone when only agents approved', () => {
    const [, review] = statusParts({ lifecycle: 'open', review: 'approved', checks: null, agentApprovers: ['reviewbot'] });
    expect(review).toEqual({ text: 'approved by agent', tone: 'good', title: 'Approved by reviewbot (agent)' });
    const [, two] = statusParts({ lifecycle: 'open', review: 'approved', checks: null, agentApprovers: ['reviewbot', 'lintbot'] });
    expect(two?.text).toBe('approved by agents');
  });
});

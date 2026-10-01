import { describe, expect, it } from 'vitest';
import type { AgentApproveOffer } from '@postpile/core';
import { approvePillWord, batchMarkReadMessage, tileApproveLabel, topicApproveLabel } from './agent-actions.ts';

function offer(overrides: Partial<AgentApproveOffer>): AgentApproveOffer {
  return { state: 'active', risk: 'medium', reason: null, covered: [], leftOut: [], coveredCount: 3, totalCount: 5, ...overrides };
}

describe('approve wording', () => {
  it('says the risk when active and the reason when greyed', () => {
    expect(approvePillWord(offer({}))).toBe('Medium risk');
    expect(approvePillWord(offer({ state: 'greyed', risk: null, reason: 'rechecking' }))).toBe('Rechecking…');
  });

  it('never counts PRs on a greyed button', () => {
    expect(topicApproveLabel(offer({}))).toBe('Approve 3 of 5 PRs');
    expect(topicApproveLabel(offer({ totalCount: 3 }))).toBe('Approve 3 PRs');
    expect(topicApproveLabel(offer({ state: 'greyed', coveredCount: 0, totalCount: 1 }))).toBe('Approve');
    expect(tileApproveLabel(offer({ totalCount: 3 }), 'set')).toBe('Approve 3 PRs');
    expect(tileApproveLabel(offer({ totalCount: 3 }), 'stack')).toBe('Approve stack');
    expect(tileApproveLabel(offer({ coveredCount: 1, totalCount: 1 }), 'single')).toBe('Approve');
    expect(tileApproveLabel(offer({ state: 'greyed', coveredCount: 0 }), 'stack')).toBe('Approve stack');
    expect(tileApproveLabel(offer({ state: 'greyed', coveredCount: 0 }), 'set')).toBe('Approve');
  });

  it('counts a partial tile like the topic', () => {
    expect(tileApproveLabel(offer({ coveredCount: 2, totalCount: 5 }), 'stack')).toBe('Approve 2 of 5 PRs');
    expect(tileApproveLabel(offer({ coveredCount: 1, totalCount: 2 }), 'set')).toBe('Approve 1 of 2 PRs');
  });
});

describe('batchMarkReadMessage', () => {
  it('names what was skipped and why', () => {
    const skipped = [{ tileId: 'a', reason: 'asks_for_you' as const }];
    expect(batchMarkReadMessage(3, skipped, 'x', true)).toBe('Marked 3 read · 1 skipped (asks for you)');
    expect(batchMarkReadMessage(3, [], 'x', true)).toBe('Marked 3 read');
  });
});

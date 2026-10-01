import { describe, expect, it } from 'vitest';
import type { AgentApproveOffer, AgentApprovePr } from '@postpile/core';
import { approvePillWord, batchMarkReadMessage, leftOutReason, tileApproveLabel, topicApproveLabel } from './agent-actions.ts';

function offer(overrides: Partial<AgentApproveOffer>): AgentApproveOffer {
  return { state: 'active', risk: 'medium', reason: null, covered: [], leftOut: [], coveredCount: 3, totalCount: 5, prCount: 5, naming: 'some', ...overrides };
}

const BASE: AgentApprovePr = { prKey: 'acme/app#109533', title: 'Base', headOid: 'abc', verdict: 'LOOKS_SAFE', riskLine: 'low', risk: 'low' };

describe('approve wording', () => {
  it('says the risk when active and the reason when greyed', () => {
    expect(approvePillWord(offer({}))).toBe('Medium risk');
    expect(approvePillWord(offer({ state: 'greyed', risk: null, reason: 'rechecking' }))).toBe('Rechecking…');
  });

  it('never counts PRs on a greyed button', () => {
    expect(topicApproveLabel(offer({}))).toBe('Approve 3 of 5 PRs');
    expect(topicApproveLabel(offer({ totalCount: 3 }))).toBe('Approve 3 PRs');
    expect(topicApproveLabel(offer({ state: 'greyed', coveredCount: 0, totalCount: 1, naming: 'none' }))).toBe('Approve');
    expect(tileApproveLabel(offer({ totalCount: 3, prCount: 3, naming: 'every' }), 'set')).toBe('Approve 3 PRs');
    expect(tileApproveLabel(offer({ totalCount: 3, prCount: 3, naming: 'every' }), 'stack')).toBe('Approve stack');
    expect(tileApproveLabel(offer({ coveredCount: 1, totalCount: 1, prCount: 1, naming: 'every' }), 'single')).toBe('Approve');
    expect(tileApproveLabel(offer({ state: 'greyed', coveredCount: 0, naming: 'none' }), 'stack')).toBe('Approve');
    expect(tileApproveLabel(offer({ state: 'greyed', coveredCount: 0, naming: 'none' }), 'set')).toBe('Approve');
  });

  it('counts a partial tile like the topic, and says stack only when it covers every PR', () => {
    expect(tileApproveLabel(offer({ coveredCount: 2, totalCount: 5 }), 'stack')).toBe('Approve 2 of 5 PRs');
    expect(tileApproveLabel(offer({ coveredCount: 2, totalCount: 2, prCount: 3 }), 'stack')).toBe('Approve 2 PRs');
  });

  // Owner, 2026-10-01: one PR out of several is named, so "Low risk" can't read as a verdict on the whole stack.
  it('names the one PR it covers out of several', () => {
    const one = offer({ covered: [BASE], coveredCount: 1, totalCount: 1, prCount: 3, naming: 'one' });
    expect(tileApproveLabel(one, 'stack')).toBe('Approve #109533');
    expect(topicApproveLabel(offer({ covered: [BASE], coveredCount: 1, totalCount: 3, naming: 'one' }))).toBe('Approve #109533');
  });

  it('says what a left-out layer waits on', () => {
    expect(leftOutReason({ reason: 'layer_below', waitsOn: 'acme/app#109499' })).toBe('waits on #109499');
    expect(leftOutReason({ reason: 'look_closer', waitsOn: null })).toBe('look closer');
  });
});

describe('batchMarkReadMessage', () => {
  it('names what was skipped and why', () => {
    const skipped = [{ tileId: 'a', reason: 'asks_for_you' as const }];
    expect(batchMarkReadMessage(3, skipped, 'x', true)).toBe('Marked 3 read · 1 skipped (asks for you)');
    expect(batchMarkReadMessage(3, [], 'x', true)).toBe('Marked 3 read');
  });
});

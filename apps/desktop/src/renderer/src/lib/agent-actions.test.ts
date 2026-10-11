import { describe, expect, it } from 'vitest';
import type { AgentApproveOffer, AgentApprovePr, TopicMarkReadOffer } from '@postpile/core';
import { agentApproveLook, approvePillWord, approveTitle, batchMarkReadMessage, leftOutReason, shownTopicOffers, tileApproveLabel, topicApproveLabel, topicMarkReadLabel, type ShownTile } from './agent-actions.ts';

function offer(overrides: Partial<AgentApproveOffer>): AgentApproveOffer {
  return { state: 'active', risk: 'medium', reason: null, covered: [], leftOut: [], coveredCount: 3, totalCount: 5, prCount: 5, naming: 'some', ...overrides };
}

const BASE: AgentApprovePr = { prKey: 'acme/app#2107', title: 'Base', headOid: 'abc', verdict: 'LOOKS_SAFE', riskLine: 'low', risk: 'low', dependsOn: [] };

describe('approve wording', () => {
  it('says the risk when active and the reason when greyed', () => {
    expect(approvePillWord(offer({}))).toBe('Medium risk');
    expect(approvePillWord(offer({ state: 'greyed', risk: null, reason: 'rechecking' }))).toBe('Checking…');
  });

  // Bug hunt MEM-A-01: with the agent off, capped or failed nothing is checking, so the pill says there is no verdict and the tooltip why.
  it('says No verdict, with the reason in the tooltip, when nothing writes a glance', () => {
    const off = offer({ state: 'greyed', risk: null, reason: 'agent_off' });
    expect(approvePillWord(off)).toBe('No verdict');
    expect(approveTitle(off)).toMatch(/^Greyed out: Agent features are off/);
    expect(approveTitle(offer({ state: 'greyed', risk: null, reason: 'agent_limit' }))).toContain('call limit');
    expect(approveTitle(offer({ state: 'greyed', risk: null, reason: 'glance_failed' }))).toContain('glance failed');
    expect(leftOutReason({ reason: 'agent_limit', waitsOn: null })).toBe('no verdict, agent limit');
  });

  it('never counts PRs on a greyed button', () => {
    expect(topicApproveLabel(offer({}))).toBe('Approve 3 of 5 PRs');
    expect(topicApproveLabel(offer({ totalCount: 3 }))).toBe('Approve 3 PRs');
    expect(topicApproveLabel(offer({ state: 'greyed', coveredCount: 0, totalCount: 1, naming: 'none' }))).toBe('Approve all');
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
    expect(tileApproveLabel(one, 'stack')).toBe('Approve #2107');
    expect(topicApproveLabel(offer({ covered: [BASE], coveredCount: 1, totalCount: 3, naming: 'one' }))).toBe('Approve #2107');
  });

  it('says what a left-out layer waits on', () => {
    expect(leftOutReason({ reason: 'layer_below', waitsOn: 'acme/app#2104' })).toBe('waits on #2104');
    expect(leftOutReason({ reason: 'look_closer', waitsOn: null })).toBe('look closer');
  });
});

describe('agentApproveLook', () => {
  it('takes a click only while active and GitHub writes are on', () => {
    expect(agentApproveLook(offer({}), null)).toEqual({ usable: true, greyed: false, title: 'Agent verdict: Looks safe.' });
    expect(agentApproveLook(offer({ state: 'greyed', reason: 'rechecking' }), null)).toMatchObject({ usable: false, greyed: true });
  });

  // 2026-10-11: locked writes left the ✨ Approve active, and a click could only fail; the pane's Approve was greyed since #176.
  it('greys while writes are locked, with the lock reason as its tooltip', () => {
    const lock = 'Approving writes to GitHub, and GitHub writes are off. Open the lock in the footer.';
    expect(agentApproveLook(offer({}), lock)).toEqual({ usable: false, greyed: true, title: lock });
  });
});

describe('batchMarkReadMessage', () => {
  it('names what was skipped and why', () => {
    const skipped = [{ tileId: 'a', reason: 'asks_for_you' as const }];
    expect(batchMarkReadMessage(3, skipped, 'x', true)).toBe('Marked 3 read · 1 skipped (asks for you)');
    expect(batchMarkReadMessage(3, [], 'x', true)).toBe('Marked 3 read');
    expect(batchMarkReadMessage(1, [{ tileId: 'b', reason: 'agent_off' }], 'x', true)).toBe('Marked 1 read · 1 skipped (agent off)');
  });
});

// Owner, 2026-10-11 (UI-A-17 item 8): the topic's bulk buttons start with a verb, also greyed.
describe('topic bulk labels', () => {
  it('say what the button does to the whole topic when greyed', () => {
    expect(topicApproveLabel(offer({ state: 'greyed', risk: null, reason: 'rechecking', coveredCount: 0, naming: 'none' }))).toBe('Approve all');
    const markRead: TopicMarkReadOffer = { state: 'greyed', risk: null, reason: 'asks_for_you', coveredTileIds: [], skipped: [], coveredCount: 0, totalCount: 2 };
    expect(topicMarkReadLabel(markRead)).toBe('Mark all read');
    expect(topicMarkReadLabel({ ...markRead, state: 'active', reason: null, risk: 'low', coveredTileIds: ['a', 'b'], coveredCount: 2 })).toBe('Mark 2 read');
  });
});

// Owner, 2026-10-11 (B-A-25 item 2): under a filter the topic buttons count only what is on screen.
describe('shownTopicOffers', () => {
  const safe = (number: number): AgentApprovePr => ({ ...BASE, prKey: `acme/app#${number}`, title: `PR ${number}` });
  const tile = (id: string, numbers: number[], markRead: ShownTile['agent']['markRead'] = null): ShownTile => ({
    tile: { id },
    state: { kind: 'unread', unreadBecause: [], unreadOnGitHub: true, loud: false },
    agent: { approve: null, markRead },
    prs: numbers.map((number) => ({ key: `acme/app#${number}` })),
  });
  const topic = offer({ covered: [safe(1), safe(2), safe(3)], coveredCount: 3, totalCount: 3, prCount: 3, risk: 'low', naming: 'every' });

  it('counts the shown PRs only: "Approve 2 PRs", not "Approve 2 of 3 PRs"', () => {
    const shown = shownTopicOffers({ approve: topic, markRead: null }, [tile('a', [1]), tile('b', [2])]);
    expect(shown.approve).toMatchObject({ state: 'active', coveredCount: 2, totalCount: 2, prCount: 2, naming: 'every' });
    expect(topicApproveLabel(shown.approve!)).toBe('Approve 2 PRs');
    expect(shown.approve?.covered.map((pr) => pr.prKey)).toEqual(['acme/app#1', 'acme/app#2']);
  });

  it('greys out when only left-out PRs are shown, and goes when none is shown', () => {
    const mixed = offer({ covered: [safe(1)], leftOut: [{ prKey: 'acme/app#2', title: 'PR 2', reason: 'rechecking', waitsOn: null, verdict: null, riskLine: null }], coveredCount: 1, totalCount: 2, prCount: 2, naming: 'one' });
    expect(shownTopicOffers({ approve: mixed, markRead: null }, [tile('b', [2])]).approve).toMatchObject({ state: 'greyed', reason: 'rechecking', naming: 'none', coveredCount: 0 });
    expect(shownTopicOffers({ approve: mixed, markRead: null }, [tile('c', [9])]).approve).toBeNull();
  });

  it('marks only the shown tiles read', () => {
    const markRead: TopicMarkReadOffer = { state: 'active', risk: 'medium', reason: null, coveredTileIds: ['a', 'b'], skipped: [{ tileId: 'c', reason: 'asks_for_you' }], coveredCount: 2, totalCount: 3 };
    const shown = shownTopicOffers({ approve: null, markRead }, [tile('a', [1], { state: 'active', risk: 'low', reason: null }), tile('c', [3])]);
    expect(shown.markRead).toMatchObject({ state: 'active', risk: 'low', coveredTileIds: ['a'], coveredCount: 1, totalCount: 2 });
    expect(shownTopicOffers({ approve: null, markRead }, [tile('c', [3])]).markRead).toMatchObject({ state: 'greyed', reason: 'asks_for_you', coveredCount: 0 });
  });
});

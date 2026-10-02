import { describe, expect, it } from 'vitest';
import {
  feedbackStatesPreference,
  isJunkReason,
  repeatsRejectedChange,
  ruleHasWordedEvidence,
  ruleTextKey,
  staleRuleProposalIds,
  staleTopicProposalIds,
} from './proposal-quality.ts';
import type { RuleProposal } from './memory.ts';
import type { TopicProposal } from './types.ts';

function topicProposal(overrides: Partial<TopicProposal>): TopicProposal {
  return {
    id: 'p1',
    kind: 'merge',
    topicId: 'billing',
    name: null,
    intoTopicId: 'payments',
    fromArea: null,
    prKeys: [],
    reason: 'They ship the same invoice rollout.',
    status: 'pending',
    createdAt: '2026-09-01T10:00:00.000Z',
    decidedAt: null,
    source: 'consolidation',
    client: null,
    ...overrides,
  };
}

function ruleProposal(overrides: Partial<RuleProposal>): RuleProposal {
  return {
    id: 'r1',
    text: 'Docs PRs are never mine.',
    topicId: null,
    evidenceFeedbackIds: [1, 2],
    reason: 'You said so on two docs PRs.',
    status: 'pending',
    createdAt: '2026-09-01T10:00:00.000Z',
    decidedAt: null,
    ...overrides,
  };
}

describe('isJunkReason', () => {
  it('drops empty, short and placeholder reasons', () => {
    for (const reason of ['', '   ', '...', 'TBD', 'n/a', 'Reason.', 'placeholder', 'This is a placeholder reason', 'both small']) {
      expect(isJunkReason(reason), reason).toBe(true);
    }
  });

  it('keeps a reason that says something', () => {
    expect(isJunkReason('They implement the same rollout; apart, the blocker is hidden.')).toBe(false);
    expect(isJunkReason('The name no longer fits the work.')).toBe(false);
  });
});

describe('rule evidence', () => {
  it('counts worded kinds and clicks with a typed note, never bare clicks or unmutes', () => {
    expect(feedbackStatesPreference({ kind: 'wrong_topic', note: '' })).toBe(false);
    expect(feedbackStatesPreference({ kind: 'not_mine', note: '  ' })).toBe(false);
    expect(feedbackStatesPreference({ kind: 'not_mine', note: 'docs PRs are never mine' })).toBe(true);
    expect(feedbackStatesPreference({ kind: 'unmute', note: 'alice commented' })).toBe(false);
    expect(feedbackStatesPreference({ kind: 'tailoring_kept', note: 'Only runner cost.' })).toBe(true);
    expect(feedbackStatesPreference({ kind: 'memory_forget', note: 'cares about flaky tests' })).toBe(true);
  });

  it('needs one cited row that states a preference', () => {
    const feedback = [
      { id: 1, kind: 'wrong_topic' as const, note: '' },
      { id: 2, kind: 'wrong_topic' as const, note: '' },
      { id: 3, kind: 'not_mine' as const, note: 'never the docs site' },
    ];
    expect(ruleHasWordedEvidence([1, 2], feedback)).toBe(false);
    expect(ruleHasWordedEvidence([1, 3], feedback)).toBe(true);
    expect(ruleHasWordedEvidence([9], feedback)).toBe(false);
  });
});

describe('repeats of rejected proposals', () => {
  it('compares rule text without case, spacing or a closing period', () => {
    expect(ruleTextKey('  Docs  PRs are never mine. ')).toBe('docs prs are never mine');
    expect(ruleTextKey('docs prs are NEVER mine!')).toBe(ruleTextKey('Docs PRs are never mine.'));
  });

  it('treats a merge of the same two topics as the same in either direction', () => {
    const rejected = [topicProposal({ status: 'rejected' })];
    expect(repeatsRejectedChange(topicProposal({}), rejected)).toBe(true);
    expect(repeatsRejectedChange(topicProposal({ topicId: 'payments', intoTopicId: 'billing' }), rejected)).toBe(true);
    expect(repeatsRejectedChange(topicProposal({ intoTopicId: 'search' }), rejected)).toBe(false);
    expect(repeatsRejectedChange(topicProposal({}), [topicProposal({ status: 'withdrawn' })])).toBe(false);
  });

  it('suppresses any rename of a topic whose rename was rejected, and splits that move the same PRs', () => {
    const rejected = [
      topicProposal({ kind: 'rename', topicId: 'billing', intoTopicId: null, name: 'Invoices', status: 'rejected' }),
      topicProposal({ id: 'p2', kind: 'split', topicId: 'billing', intoTopicId: null, name: 'Tax', prKeys: ['acme/app#4'], status: 'rejected' }),
    ];
    expect(repeatsRejectedChange(topicProposal({ kind: 'rename', intoTopicId: null, name: 'Invoice rollout' }), rejected)).toBe(true);
    expect(repeatsRejectedChange(topicProposal({ kind: 'rename', topicId: 'search', intoTopicId: null, name: 'Invoices' }), rejected)).toBe(false);
    expect(repeatsRejectedChange(topicProposal({ kind: 'split', intoTopicId: null, name: 'VAT', prKeys: ['acme/app#4', 'acme/app#5'] }), rejected)).toBe(true);
    expect(repeatsRejectedChange(topicProposal({ kind: 'split', intoTopicId: null, name: 'VAT', prKeys: ['acme/app#5'] }), rejected)).toBe(false);
  });

  it('treats an area fold of the same two areas as the same either way', () => {
    const rejected = [topicProposal({ kind: 'area_merge', topicId: null, intoTopicId: null, fromArea: 'CI & tests', name: 'CI', status: 'rejected' })];
    const reverse = topicProposal({ kind: 'area_merge', topicId: null, intoTopicId: null, fromArea: 'CI', name: 'CI & tests' });
    expect(repeatsRejectedChange(reverse, rejected)).toBe(true);
  });
});

describe('stale proposals', () => {
  const active = new Set(['billing', 'search']);
  const isActive = (id: string): boolean => active.has(id);

  it('withdraws topic proposals naming a topic that is no longer active, on either side of a merge', () => {
    const pending = [
      topicProposal({ id: 'into-gone' }),
      topicProposal({ id: 'from-gone', topicId: 'payments', intoTopicId: 'billing' }),
      topicProposal({ id: 'fine', intoTopicId: 'search' }),
      topicProposal({ id: 'rename-gone', kind: 'rename', topicId: 'retired-one', intoTopicId: null, name: 'Old' }),
      topicProposal({ id: 'area', kind: 'area_merge', topicId: null, intoTopicId: null, fromArea: 'CI', name: 'Build' }),
    ];
    expect(staleTopicProposalIds(pending, isActive)).toEqual(['into-gone', 'from-gone', 'rename-gone']);
  });

  it('withdraws topic rules of inactive topics, never global ones', () => {
    const pending = [ruleProposal({ id: 'global' }), ruleProposal({ id: 'live', topicId: 'billing' }), ruleProposal({ id: 'gone', topicId: 'payments' })];
    expect(staleRuleProposalIds(pending, isActive)).toEqual(['gone']);
  });
});

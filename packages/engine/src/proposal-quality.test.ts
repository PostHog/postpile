import type { RuleProposal, TopicProposal } from '@postpile/core';
import { at } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { topicWithPrs } from './testing/topics.ts';
import { changeTopicStatus } from './topic-status.ts';

function topicProposal(overrides: Partial<TopicProposal>): TopicProposal {
  return {
    id: 'p1',
    kind: 'merge',
    topicId: 'billing',
    name: null,
    intoTopicId: 'payments',
    fromArea: null,
    prKeys: [],
    reason: 'Both carry the invoice rollout.',
    status: 'pending',
    createdAt: at(1),
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
    createdAt: at(1),
    decidedAt: null,
    ...overrides,
  };
}

/** Two topics with a PR each, so both stay active until a test changes that. */
function twoTopics(h: Harness): void {
  topicWithPrs(h, 'billing', [reviewRequestedPr(1)]);
  topicWithPrs(h, 'payments', [reviewRequestedPr(2)]);
}

describe('withdrawing stale proposals', () => {
  it('withdraws what names a topic the moment it retires or is archived', async () => {
    const h = makeHarness();
    twoTopics(h);
    h.store.proposals.add(topicProposal({ id: 'merge' }));
    h.store.proposals.add(topicProposal({ id: 'rename', kind: 'rename', intoTopicId: null, name: 'Invoices' }));
    h.store.ruleProposals.add(ruleProposal({ id: 'topic-rule', topicId: 'payments' }));
    h.store.ruleProposals.add(ruleProposal({ id: 'global-rule', text: 'Skip bot PRs.' }));

    changeTopicStatus(h.store, 'payments', 'retire', at(2));

    expect(h.store.proposals.get('merge')).toMatchObject({ status: 'withdrawn', decidedAt: at(2) });
    expect(h.store.ruleProposals.get('topic-rule')?.status).toBe('withdrawn');
    const pending = await h.engine.listProposals();
    expect(pending.topics.map((p) => p.id)).toEqual(['rename']);
    expect(pending.rules.map((r) => r.id)).toEqual(['global-rule']);

    changeTopicStatus(h.store, 'billing', 'archive', at(3));
    expect(h.store.proposals.get('rename')?.status).toBe('withdrawn');
  });

  it('withdraws on every sync, whatever took the topic away', async () => {
    const h = makeHarness();
    twoTopics(h);
    h.store.proposals.add(topicProposal({ id: 'merge', intoTopicId: 'gone' }));
    h.store.ruleProposals.add(ruleProposal({ id: 'topic-rule', topicId: 'gone' }));

    await h.engine.sync({ agentJobs: [] });

    expect(h.store.proposals.get('merge')?.status).toBe('withdrawn');
    expect(h.store.ruleProposals.get('topic-rule')?.status).toBe('withdrawn');
  });

  it('leaves the same merge in the Inbox when it is the one being accepted', async () => {
    const h = makeHarness();
    twoTopics(h);
    h.store.proposals.add(topicProposal({ id: 'merge' }));
    h.store.proposals.add(topicProposal({ id: 'rename', kind: 'rename', intoTopicId: null, name: 'Invoices' }));

    await h.engine.decideTopicProposal('merge', true);

    expect(h.store.proposals.get('merge')?.status).toBe('accepted');
    expect(h.store.proposals.get('rename')?.status).toBe('withdrawn');
  });

  it('never shows a withdrawn proposal to consolidation as the user deciding', async () => {
    const h = makeHarness();
    twoTopics(h);
    topicWithPrs(h, 'search', [reviewRequestedPr(3)]);
    h.store.proposals.add(topicProposal({ id: 'withdrawn-merge', intoTopicId: 'search' }));
    h.store.proposals.add(topicProposal({ id: 'rejected-rename', kind: 'rename', intoTopicId: null, name: 'Invoices' }));
    h.store.proposals.decide('rejected-rename', 'rejected', at(2));
    h.store.ruleProposals.add(ruleProposal({ id: 'withdrawn-rule', topicId: 'search' }));
    changeTopicStatus(h.store, 'search', 'retire', at(3));
    h.agent.answerConsolidation(() => ({}));

    await h.engine.consolidate();

    const [input] = h.agent.consolidationInputs;
    expect(input?.decidedTopicProposals.map((p) => p.id)).toEqual(['rejected-rename']);
    expect(input?.decidedRules).toEqual([]);
  });
});

describe('repeats of rejected proposals', () => {
  it('files no merge of two topics the user kept apart, in either direction', async () => {
    const h = makeHarness();
    twoTopics(h);
    h.store.proposals.add(topicProposal({ id: 'rejected' }));
    h.store.proposals.decide('rejected', 'rejected', at(2));
    h.agent.answerConsolidation(() => ({
      topicProposals: [{ kind: 'merge', topicId: 'payments', intoTopicId: 'billing', reason: 'Both carry the invoice rollout.' }],
    }));

    const report = await h.engine.consolidate();

    expect(report.topicProposalsFiled).toBe(0);
    expect((await h.engine.listProposals()).topics).toEqual([]);
  });

  it('files a merge again after the earlier one was only withdrawn', async () => {
    const h = makeHarness();
    twoTopics(h);
    h.store.proposals.add(topicProposal({ id: 'old' }));
    h.store.proposals.decide('old', 'withdrawn', at(2));
    h.agent.answerConsolidation(() => ({
      topicProposals: [{ kind: 'merge', topicId: 'billing', intoTopicId: 'payments', reason: 'Both carry the invoice rollout again.' }],
    }));

    const report = await h.engine.consolidate();

    expect(report.topicProposalsFiled).toBe(1);
  });

  it('files no rule whose text matches a rejected one, case and closing period aside', async () => {
    const h = makeHarness();
    twoTopics(h);
    h.store.ruleProposals.add(ruleProposal({ id: 'rejected' }));
    h.store.ruleProposals.decide('rejected', 'rejected', at(2));
    h.agent.answerConsolidation(() => ({
      ruleIdeas: [{ text: 'docs PRs are  never mine', topicId: null, evidenceFeedbackIds: [1, 2], reason: 'You said so on two docs PRs.' }],
    }));

    const report = await h.engine.consolidate();

    expect(report.ruleProposalsFiled).toBe(0);
  });
});

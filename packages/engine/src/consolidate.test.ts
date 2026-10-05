import { emptyDossier, type Dossier, type Pr } from '@postpile/core';
import { at, makeComment, makeFact, makeFactRef, makeThreadFor, viewer } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { readThreadsOnGitHub, topicWithPrs } from './testing/topics.ts';
import { changeTopicStatus } from './topic-status.ts';

/** Four weeks after the fixture PRs' activity, so the 3 quiet days have passed. */
const MONTH_LATER = new Date('2026-09-30T12:00:00Z');

/**
 * Past the 2 quiet days but within SETTLED_DAYS, so the PRs are still hot:
 * consolidation leaves a topic whose PRs all went cold to the retire step.
 */
const FOUR_DAYS_LATER = new Date('2026-09-05T12:00:00Z');

function finishedDossier(): Dossier {
  return { ...emptyDossier(), summary: 'Done.', status: 'finished' };
}

function mergedPr(number: number): Pr {
  return reviewRequestedPr(number, { state: 'MERGED', mergedAt: at(5), mergedBy: 'alice' });
}

/** Synced, dossier written, every event seen: the shape of a topic that is over. */
async function finishedTopic(h: Harness, prs: Pr[]): Promise<void> {
  topicWithPrs(h, 'depot', prs);
  await h.engine.sync({ agentJobs: ['dossiers'] });
  const eventIds = prs.flatMap((pr) => h.store.events.listForPr(pr.key).map((e) => e.id));
  h.store.events.markSeen(eventIds, at(6));
  readThreadsOnGitHub(h, prs);
}

describe('Engine.consolidate', () => {
  it('is not due before any dossier exists', async () => {
    const h = makeHarness();

    const report = await h.engine.consolidate({ onlyIfDue: true });

    expect(report.skipped).toBe('not_due');
    expect(report.agentCallStats.total).toBe(0);
  });

  it('is due once, then waits 24 hours and for a new dossier version', async () => {
    const h = makeHarness();
    topicWithPrs(h, 'depot', [reviewRequestedPr(1)]);
    await h.engine.sync({ agentJobs: ['dossiers'] });

    const first = await h.engine.consolidate({ onlyIfDue: true });
    const second = await h.engine.consolidate({ onlyIfDue: true });

    expect(first).toMatchObject({ skipped: null, errors: [] });
    expect(first.agentCallStats.byKind.consolidation?.calls).toBe(1);
    expect(second.skipped).toBe('not_due');
  });

  it('files topic proposals once, with clean names, and never again after a rejection', async () => {
    const h = makeHarness();
    const prs = [reviewRequestedPr(1), reviewRequestedPr(2)];
    topicWithPrs(h, 'depot', prs);
    const answer = () => ({
      topicProposals: [
        { kind: 'rename' as const, topicId: 'depot', name: 'Depot\n  runners', reason: 'clearer' },
        { kind: 'split' as const, topicId: 'depot', name: 'Runner images', prKeys: [prs[1]!.key], reason: 'separate work' },
        { kind: 'rename' as const, topicId: 'nope', name: 'Made up', reason: 'unknown topic' },
        // Nothing left after cleaning: never filed.
        { kind: 'rename' as const, topicId: 'depot', name: '\u0000\n', reason: 'blank' },
      ],
    });
    h.agent.answerConsolidation(answer);

    const report = await h.engine.consolidate();

    // The one-PR split is small, so it was applied right away.
    expect(report).toMatchObject({ topicProposalsFiled: 1, topicsSplit: 1 });
    const pending = await h.engine.listProposals();
    expect(pending.topics.map((p) => `${p.kind} ${p.name}`)).toEqual(['rename Depot runners']);

    const rename = pending.topics.find((p) => p.kind === 'rename');
    await h.engine.decideTopicProposal(rename!.id, false);
    h.agent.answerConsolidation(answer);
    const again = await h.engine.consolidate();
    expect(again).toMatchObject({ topicProposalsFiled: 0, topicsSplit: 0 });
  });

  it('applies a small split right away: the PRs move into a new topic', async () => {
    const h = makeHarness();
    const prs = [reviewRequestedPr(1), reviewRequestedPr(2)];
    topicWithPrs(h, 'depot', prs);
    h.agent.answerConsolidation(() => ({
      topicProposals: [{ kind: 'split', topicId: 'depot', name: 'Runner images', prKeys: [prs[1]!.key], reason: 'separate' }],
    }));

    await h.engine.consolidate();

    const newTopicId = h.store.memberships.get(prs[1]!.key)?.topicId;
    expect(newTopicId).not.toBe('depot');
    expect(h.store.topics.get(newTopicId!)?.name).toBe('Runner images');
    expect(h.store.memberships.get(prs[0]!.key)?.topicId).toBe('depot');
    expect((await h.engine.listProposals()).topics).toEqual([]);
  });

  it('proposes a bigger split, or one that would empty the topic, and moves the PRs once accepted', async () => {
    const h = makeHarness();
    const prs = [1, 2, 3, 4, 5].map((n) => reviewRequestedPr(n));
    topicWithPrs(h, 'depot', prs);
    topicWithPrs(h, 'tiny', [reviewRequestedPr(9)]);
    h.agent.answerConsolidation(() => ({
      topicProposals: [
        { kind: 'split', topicId: 'depot', name: 'Runner images', prKeys: prs.slice(1).map((pr) => pr.key), reason: 'separate' },
        { kind: 'split', topicId: 'tiny', name: 'Everything', prKeys: [reviewRequestedPr(9).key], reason: 'all of it' },
      ],
    }));

    const report = await h.engine.consolidate();

    expect(report).toMatchObject({ topicProposalsFiled: 2, topicsSplit: 0 });
    const split = (await h.engine.listProposals()).topics.find((p) => p.topicId === 'depot');
    await h.engine.decideTopicProposal(split!.id, true);
    expect(h.store.topics.get(h.store.memberships.get(prs[4]!.key)!.topicId)?.name).toBe('Runner images');
    expect(h.store.memberships.get(prs[0]!.key)?.topicId).toBe('depot');
  });

  it('files rule proposals; an accepted global rule goes into every prompt', async () => {
    const h = makeHarness();
    topicWithPrs(h, 'depot', [reviewRequestedPr(1)]);
    const rule = { text: 'Preview deploys are never mine.', topicId: null, evidenceFeedbackIds: [1, 2, 3], reason: 'said three times' };
    h.agent.answerConsolidation(() => ({ ruleIdeas: [rule, { ...rule, text: ' preview deploys are never mine. ' }] }));

    const report = await h.engine.consolidate();

    expect(report.ruleProposalsFiled).toBe(1);
    const [proposal] = (await h.engine.listProposals()).rules;
    expect(await h.engine.decideRuleProposal(proposal!.id, true)).toMatchObject({ ok: true });
    await h.engine.sync({ agentJobs: ['dossiers'] });
    expect(h.agent.dossierInputs[0]?.context.standingRules).toEqual(['Preview deploys are never mine.']);
  });

  it('appends an accepted topic rule to the topic tailoring', async () => {
    const h = makeHarness();
    topicWithPrs(h, 'depot', [reviewRequestedPr(1)]);
    h.store.topics.setTailoring('depot', 'Only runner cost.', at(1));
    h.agent.answerConsolidation(() => ({
      ruleIdeas: [{ text: 'Ignore cache warmers.', topicId: 'depot', evidenceFeedbackIds: [], reason: 'repeated' }],
    }));
    await h.engine.consolidate();
    const [proposal] = (await h.engine.listProposals()).rules;

    await h.engine.decideRuleProposal(proposal!.id, true);

    expect(h.store.topics.get('depot')?.tailoring).toBe('Only runner cost.\nIgnore cache warmers.');
    expect((await h.engine.listProposals()).rules).toEqual([]);
  });

  it('offers facts about different objects of a non-unique predicate as separate', async () => {
    const h = makeHarness();
    topicWithPrs(h, 'depot', [reviewRequestedPr(1), reviewRequestedPr(2)]);
    h.store.facts.add(makeFact({ id: 'f1', topicId: 'depot' }));
    h.store.facts.add(makeFact({ id: 'f2', topicId: 'depot', object: { kind: 'pr', key: 'acme/app#2' }, text: 'alice works on #2' }));
    h.agent.answerConsolidation((input) => {
      expect(input.duplicateFacts).toEqual([]);
      return {};
    });

    await h.engine.consolidate();

    expect(h.agent.consolidationInputs).toHaveLength(1);
  });

  it('folds duplicate facts into the kept one', async () => {
    const h = makeHarness();
    topicWithPrs(h, 'depot', [reviewRequestedPr(1)]);
    h.store.facts.add(makeFact({ id: 'f1', topicId: 'depot' }));
    h.store.facts.add(makeFact({ id: 'f2', topicId: 'depot', text: 'alice is on #1', refs: [makeFactRef({ kind: 'comment', sourceId: 'c1' })] }));
    h.agent.answerConsolidation((input) => {
      expect(input.duplicateFacts.map((group) => group.map((f) => f.id).sort())).toEqual([['f1', 'f2']]);
      return { factMerges: [{ keepId: 'f1', dropIds: ['f2'], reason: 'same claim' }] };
    });

    const report = await h.engine.consolidate();

    expect(report.factsMerged).toBe(1);
    expect(h.store.facts.get('f2')).toMatchObject({ supersededBy: 'f1' });
    expect(h.store.facts.get('f2')?.expiredAt).not.toBeNull();
    expect(h.store.facts.get('f1')?.refs).toHaveLength(2);
  });

  it('retires a finished topic only when the gate holds', async () => {
    const h = makeHarness({ now: () => FOUR_DAYS_LATER });
    await finishedTopic(h, [mergedPr(1)]);
    h.agent.answerConsolidation(() => ({ finishedTopics: [{ topicId: 'depot', reason: 'all merged' }] }));

    const report = await h.engine.consolidate();

    expect(report.topicsRetired).toBe(1);
    expect(h.store.topics.get('depot')?.status).toBe('retired');
  });

  it('leaves a topic whose PRs all went cold out of consolidation', async () => {
    const h = makeHarness({ now: () => MONTH_LATER });
    await finishedTopic(h, [mergedPr(1)]);
    h.agent.answerConsolidation(() => ({ finishedTopics: [{ topicId: 'depot', reason: 'all merged' }] }));

    const report = await h.engine.consolidate();

    expect(report.agentCallStats.byKind.consolidation).toBeUndefined();
    expect(h.store.topics.get('depot')?.status).toBe('active');
  });

  it('keeps a topic with an open PR even when the agent calls it finished', async () => {
    const h = makeHarness({ now: () => MONTH_LATER });
    await finishedTopic(h, [mergedPr(1), reviewRequestedPr(2)]);
    h.agent.answerConsolidation(() => ({ finishedTopics: [{ topicId: 'depot', reason: 'looks done' }] }));

    const report = await h.engine.consolidate();

    expect(report.topicsRetired).toBe(0);
    expect(h.store.topics.get('depot')?.status).toBe('active');
  });

  it('retires a topic whose dossier says finished without any agent call', async () => {
    const h = makeHarness({ now: () => FOUR_DAYS_LATER });
    h.agent.answerDossier(() => ({ dossier: finishedDossier() }));
    await finishedTopic(h, [mergedPr(1)]);

    const report = await h.engine.consolidate({ maxAgentCalls: 0 });

    expect(report.agentCallStats.byKind.consolidation?.skippedByBudget).toBe(1);
    expect(report.topicsRetired).toBe(1);
  });

  it('brings a retired topic back when one of its PRs gets a new loud event', async () => {
    const h = makeHarness({ now: () => MONTH_LATER });
    const pr = mergedPr(1);
    await finishedTopic(h, [pr]);
    changeTopicStatus(h.store, 'depot', 'retire', MONTH_LATER.toISOString());

    const mention = { ...pr, comments: [makeComment({ id: 'c5', author: 'bob', body: `@${viewer.login} one more thing`, createdAt: at(100) })] };
    h.reader.addPr(mention, makeThreadFor(mention, { reason: 'mention', updatedAt: '2026-10-01T00:00:00.000Z' }));
    h.reader.etag = 'etag-2';
    await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.store.topics.get('depot')?.status).toBe('active');
  });

  it('brings a retired topic back when a new PR is assigned to it', async () => {
    const h = makeHarness({ now: () => MONTH_LATER });
    await finishedTopic(h, [mergedPr(1)]);
    changeTopicStatus(h.store, 'depot', 'retire', MONTH_LATER.toISOString());
    const followUp = reviewRequestedPr(7);
    h.reader.addPr(followUp, makeThreadFor(followUp));
    h.reader.etag = 'etag-2';
    h.runner.answer('topic_assignment', { assignments: [{ prKey: followUp.key, kind: 'existing', topicId: 'depot', reason: 'follow-up' }] });

    await h.engine.sync({ agentJobs: ['topics'] });

    expect(h.runner.promptsFor('topic_assignment')[0]).toContain('depot');
    expect(h.store.topics.get('depot')?.status).toBe('active');
  });
});

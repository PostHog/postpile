import type { GlanceBatchInput } from '@postpile/agent';
import { describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { topicWithPrs } from './testing/topics.ts';

// One call per topic (DESIGN.md "One call per topic"): with the switch on, a
// topic's dossier update carries its most urgent glances, and the glance
// batches only cover the rest.

function depot(h: Harness, count: number): string[] {
  const prs = Array.from({ length: count }, (_, i) => reviewRequestedPr(i + 1));
  topicWithPrs(h, 'depot', prs);
  return prs.map((pr) => pr.key);
}

function calls(report: { agentCallStats: { byKind: Partial<Record<string, { calls: number }>> } }, kind: string): number {
  return report.agentCallStats.byKind[kind]?.calls ?? 0;
}

describe('topic digest', () => {
  it('writes the dossier and the glances in one call, stamped as current', async () => {
    const h = makeHarness({ topicDigest: true });
    const keys = depot(h, 2);

    const report = await h.engine.sync({ agentJobs: ['dossiers', 'glances'] });

    expect(calls(report, 'topic_digest')).toBe(1);
    expect(calls(report, 'dossier_update')).toBe(0);
    expect(calls(report, 'glance_batch')).toBe(0);
    for (const key of keys) {
      const detail = await h.engine.getPr(key);
      expect(detail?.glance?.dossierVersion).toBe(1);
      expect(detail?.glanceStale).toBe(false);
    }
    expect((await h.engine.sync({ agentJobs: ['dossiers', 'glances'] })).agentCalls).toBe(0);
  });

  it('leaves PRs past the first batch to the glance batches', async () => {
    const h = makeHarness({ topicDigest: true });
    depot(h, 20);

    const report = await h.engine.sync({ agentJobs: ['dossiers', 'glances'] });

    expect(calls(report, 'topic_digest')).toBe(1);
    expect(h.agent.topicDigestInputs[0]?.glances.items).toHaveLength(18);
    expect(calls(report, 'glance_batch')).toBe(1);
    expect(h.agent.glanceInputs[0]?.items).toHaveLength(2);
  });

  it('sends a glance the answer left out to the glance batches', async () => {
    const h = makeHarness({ topicDigest: true });
    const keys = depot(h, 2);
    h.agent.answerGlances((input: GlanceBatchInput) => {
      const all = h.agent.allGlances(input);
      return { ...all, glances: all.glances.slice(0, 1), missing: [input.items[1]!.pr.key] };
    });

    const report = await h.engine.sync({ agentJobs: ['dossiers', 'glances'] });

    expect(calls(report, 'glance_batch')).toBe(1);
    expect(h.agent.glanceInputs[0]?.items.map((item) => item.pr.key)).toEqual([keys[1]]);
    expect((await h.engine.getPr(keys[1]!))?.glanceStale).toBe(false);
  });

  it('is off by default: separate dossier and glance calls', async () => {
    const h = makeHarness();
    depot(h, 2);

    const report = await h.engine.sync({ agentJobs: ['dossiers', 'glances'] });

    expect(calls(report, 'topic_digest')).toBe(0);
    expect(calls(report, 'dossier_update')).toBe(1);
    expect(calls(report, 'glance_batch')).toBe(1);
  });
});

describe('topic digest with sets', () => {
  it('carries the set changes when a regroup is due, and the set job does not ask again', async () => {
    const h = makeHarness({ topicDigest: true });
    const keys = depot(h, 3);
    h.agent.answerDigestSets({ created: [{ title: 'Cache keys', take: 'Same key change.', members: [{ prKey: keys[0]!, reason: 'a' }, { prKey: keys[1]!, reason: 'b' }] }] });

    const report = await h.engine.sync({ agentJobs: ['dossiers', 'glances', 'sets'] });

    expect(h.agent.topicDigestInputs[0]?.sets).not.toBeNull();
    expect(h.store.sets.listActiveForTopic('depot').map((set) => set.members.map((m) => m.prKey))).toEqual([[keys[0], keys[1]]]);
    expect(calls(report, 'topic_digest')).toBe(1);
    expect(calls(report, 'set_grouping')).toBe(0);
  });

  it('leaves the sets to the set job when the set part was unusable', async () => {
    const h = makeHarness({ topicDigest: true });
    depot(h, 3);
    h.agent.answerDigestSets(null);
    h.runner.answer('set_grouping', {});

    const report = await h.engine.sync({ agentJobs: ['dossiers', 'glances', 'sets'] });

    expect(calls(report, 'set_grouping')).toBe(1);
  });

  it('asks for no set part when the run has no set job', async () => {
    const h = makeHarness({ topicDigest: true });
    depot(h, 3);

    await h.engine.sync({ agentJobs: ['dossiers', 'glances'] });

    expect(h.agent.topicDigestInputs[0]?.sets).toBeNull();
  });

  it('writes no glances and no set part when the run has no glance job', async () => {
    const h = makeHarness({ topicDigest: true });
    depot(h, 3);
    h.runner.answer('set_grouping', {});

    const report = await h.engine.sync({ agentJobs: ['dossiers', 'sets'] });

    expect(calls(report, 'topic_digest')).toBe(0);
    expect(calls(report, 'dossier_update')).toBe(1);
  });
});

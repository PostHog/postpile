import type { FullPr, Glance, Pr } from '@postpile/core';
import { at, makeThreadFor } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { makeTopic, topicWithPrs } from './testing/topics.ts';

// Sets are lasting tiles (DESIGN.md "Tiles hold still"): the agent answers
// with changes only, every change is recorded with its reason, and status
// never moves a PR.

function glance(prKey: string, risk: string): Glance {
  return {
    prKey,
    verdict: 'LOOKS_SAFE',
    forYou: '',
    does: '',
    risk,
    othersSaid: '',
    keyFiles: [],
    pullInReason: null,
    dossierVersion: null,
    inputHash: 'h',
    model: 'fake-model',
    createdAt: at(3),
  };
}

function member(pr: Pr, reason = 'same runner change'): { prKey: string; reason: string } {
  return { prKey: pr.key, reason };
}

/** The topic "depot" with one set over the first two PRs; the rest stay open and in no set. */
async function depotWithSet(prs: FullPr[]): Promise<{ h: Harness; setId: string }> {
  const h = makeHarness();
  topicWithPrs(h, 'depot', prs);
  h.runner.answer('set_grouping', { newSets: [{ title: 'Runner switch', take: 'Both switch runners.', members: [member(prs[0]!), member(prs[1]!)] }] });
  await h.engine.sync({ agentJobs: ['sets'] });
  return { h, setId: h.store.sets.listActiveForTopic('depot')[0]!.id };
}

function changes(h: Harness): string[] {
  return h.store.sets.listChangesForTopic('depot', 50).map((change) => `${change.kind} ${change.prKey ?? '-'} (${change.by}): ${change.reason}`);
}

describe('lasting sets', () => {
  it('records a new set and its members with their reasons', async () => {
    const prs = [reviewRequestedPr(1), reviewRequestedPr(2)];
    const { h } = await depotWithSet(prs);

    expect(changes(h).reverse()).toEqual([
      'created - (agent): Both switch runners.',
      'joined acme/app#1 (agent): same runner change',
      'joined acme/app#2 (agent): same runner change',
    ]);
    const detail = await h.engine.getTopic('depot');
    expect(detail?.setChanges).toHaveLength(3);
  });

  it('keeps what the answer leaves out, adds a join and keeps the id on a rewrite', async () => {
    const prs = [reviewRequestedPr(1), reviewRequestedPr(2), reviewRequestedPr(3)];
    const { h, setId } = await depotWithSet(prs);

    // #3 is new to the set's triggers only once its risk changes; a rewrite and a join in one answer.
    h.store.glances.put(glance(prs[2]!.key, 'low - same cap'));
    h.runner.answer('set_grouping', {
      joins: [{ setId, prKey: prs[2]!.key, reason: 'the same runner change in a third repo' }],
      updates: [{ setId, title: 'Runner switch everywhere', take: 'Same switch in three places.' }],
    });
    await h.engine.sync({ agentJobs: ['sets'] });

    const sets = h.store.sets.listActiveForTopic('depot');
    expect(sets.map((set) => set.id)).toEqual([setId]);
    expect(sets[0]?.title).toBe('Runner switch everywhere');
    expect(sets[0]?.members.map((m) => m.prKey)).toEqual(prs.map((pr) => pr.key));
    expect(changes(h).slice(0, 2)).toEqual([
      'joined acme/app#3 (agent): the same runner change in a third repo',
      'updated - (agent): now "Runner switch everywhere": Same switch in three places.',
    ]);

    // An answer that mentions nothing changes nothing.
    h.store.glances.put(glance(prs[0]!.key, 'medium - new step'));
    h.runner.answer('set_grouping', {});
    await h.engine.sync({ agentJobs: ['sets'] });
    expect(h.store.sets.listActiveForTopic('depot')[0]?.members).toHaveLength(3);
  });

  it('does not ask again when a member merges, and the set keeps it', async () => {
    const prs = [reviewRequestedPr(1), reviewRequestedPr(2)];
    const { h, setId } = await depotWithSet(prs);

    h.reader.addPr({ ...prs[0]!, state: 'MERGED', updatedAt: at(5) }, makeThreadFor(prs[0]!));
    const report = await h.engine.sync({ agentJobs: ['sets'] });

    expect(report.agentCalls).toBe(0);
    expect(h.store.sets.get(setId)?.members.map((m) => m.prKey)).toEqual(prs.map((pr) => pr.key));
  });

  it('asks again when a risk level changes, and ends a set a leave brings below two', async () => {
    const prs = [reviewRequestedPr(1), reviewRequestedPr(2)];
    const { h, setId } = await depotWithSet(prs);
    h.store.glances.put(glance(prs[0]!.key, 'low - one line'));
    h.store.glances.put(glance(prs[1]!.key, 'low - one line'));
    h.runner.answer('set_grouping', {});
    await h.engine.sync({ agentJobs: ['sets'] });

    // Same level in other words: no new call.
    h.store.glances.put(glance(prs[1]!.key, 'Low. Still one line.'));
    expect((await h.engine.sync({ agentJobs: ['sets'] })).agentCalls).toBe(0);

    h.store.glances.put(glance(prs[1]!.key, 'high - now touches migrations'));
    h.runner.answer('set_grouping', { leaves: [{ setId, prKey: prs[1]!.key, reason: 'its risk is now high' }] });
    await h.engine.sync({ agentJobs: ['sets'] });

    expect(h.store.sets.get(setId)).toBeNull();
    expect(changes(h).slice(0, 2)).toEqual(['ended - (agent): fewer than two PRs left', 'left acme/app#2 (agent): its risk is now high']);
  });

  it('merges two sets that became one piece of work', async () => {
    const h = makeHarness();
    const prs = [1, 2, 3, 4, 5].map((n) => reviewRequestedPr(n));
    topicWithPrs(h, 'depot', prs);
    h.runner.answer('set_grouping', {
      newSets: [
        { title: 'Cache keys', take: '', members: [member(prs[0]!), member(prs[1]!)] },
        { title: 'Cache paths', take: '', members: [member(prs[2]!), member(prs[3]!)] },
      ],
    });
    await h.engine.sync({ agentJobs: ['sets'] });
    const created = h.store.sets.listActiveForTopic('depot');
    const keys = created.find((set) => set.title === 'Cache keys');
    const paths = created.find((set) => set.title === 'Cache paths');

    h.store.glances.put(glance(prs[4]!.key, 'low - docs'));
    h.runner.answer('set_grouping', { merges: [{ setId: paths!.id, intoSetId: keys!.id, reason: 'both are the same cache rework now' }] });
    await h.engine.sync({ agentJobs: ['sets'] });

    const sets = h.store.sets.listActiveForTopic('depot');
    expect(sets.map((set) => set.id)).toEqual([keys!.id]);
    expect(sets[0]?.members.map((m) => m.prKey)).toEqual(prs.slice(0, 4).map((pr) => pr.key));
    expect(changes(h)).toContain('merged - (agent): into "Cache keys": both are the same cache rework now');
  });

  it('lets a member that moved to another topic leave by rule', async () => {
    const prs = [reviewRequestedPr(1), reviewRequestedPr(2), reviewRequestedPr(3)];
    const { h, setId } = await depotWithSet(prs);
    h.runner.answer('set_grouping', { joins: [{ setId, prKey: prs[2]!.key, reason: 'same change' }] });
    h.store.glances.put(glance(prs[2]!.key, 'low - same'));
    await h.engine.sync({ agentJobs: ['sets'] });
    h.store.topics.create(makeTopic('billing'));

    await h.engine.giveFeedback({ kind: 'wrong_topic', tileId: `set:${setId}`, prKey: prs[2]!.key, targetTopicId: 'billing', note: '' });
    await h.engine.sync({ agentJobs: ['sets'] });

    expect(h.store.sets.get(setId)?.members.map((m) => m.prKey)).toEqual([prs[0]!.key, prs[1]!.key]);
    expect(changes(h)[0]).toBe('left acme/app#3 (rules): moved to another topic');
  });

  it('records "not related" as the user taking a PR out', async () => {
    const prs = [reviewRequestedPr(1), reviewRequestedPr(2)];
    const { h, setId } = await depotWithSet(prs);

    await h.engine.giveFeedback({ kind: 'not_related', tileId: `set:${setId}`, prKey: prs[1]!.key, targetTopicId: null, note: '' });

    expect(changes(h).slice(0, 2)).toEqual(['ended - (user): fewer than two PRs left', 'left acme/app#2 (user): you said not related']);
  });

  it('keeps the user\'s "not related" when the set ends or merges', async () => {
    const h = makeHarness();
    const prs = [1, 2, 3, 4, 5].map((n) => reviewRequestedPr(n));
    topicWithPrs(h, 'depot', prs);
    h.runner.answer('set_grouping', {
      newSets: [
        { title: 'Cache keys', take: '', members: [member(prs[0]!), member(prs[1]!), member(prs[2]!)] },
        { title: 'Cache paths', take: '', members: [member(prs[3]!), member(prs[4]!)] },
      ],
    });
    await h.engine.sync({ agentJobs: ['sets'] });
    const created = h.store.sets.listActiveForTopic('depot');
    const keys = created.find((set) => set.title === 'Cache keys')!;
    const paths = created.find((set) => set.title === 'Cache paths')!;
    await h.engine.giveFeedback({ kind: 'not_related', tileId: `set:${keys.id}`, prKey: prs[2]!.key, targetTopicId: null, note: '' });

    // Merged into another set, the correction moves along.
    h.runner.answer('set_grouping', { merges: [{ setId: keys.id, intoSetId: paths.id, reason: 'one cache rework' }] });
    await h.engine.sync({ agentJobs: ['sets'] });
    expect(h.store.sets.get(paths.id)?.removedKeys).toEqual([prs[2]!.key]);

    // The agent tries to bring #3 back: the correction still holds.
    h.store.glances.put(glance(prs[2]!.key, 'low - same'));
    h.runner.answer('set_grouping', { joins: [{ setId: paths.id, prKey: prs[2]!.key, reason: 'cache' }] });
    await h.engine.sync({ agentJobs: ['sets'] });
    expect(h.store.sets.get(paths.id)?.members.map((m) => m.prKey)).not.toContain(prs[2]!.key);
  });

  it('keeps an ended set with corrections as dissolved, so they still hold', async () => {
    const prs = [reviewRequestedPr(1), reviewRequestedPr(2), reviewRequestedPr(3)];
    const h = makeHarness();
    topicWithPrs(h, 'depot', prs);
    h.runner.answer('set_grouping', { newSets: [{ title: 'Runner switch', take: '', members: prs.map((pr) => member(pr)) }] });
    await h.engine.sync({ agentJobs: ['sets'] });
    const setId = h.store.sets.listActiveForTopic('depot')[0]!.id;
    await h.engine.giveFeedback({ kind: 'not_related', tileId: `set:${setId}`, prKey: prs[2]!.key, targetTopicId: null, note: '' });

    h.store.glances.put(glance(prs[1]!.key, 'high - migrations'));
    h.runner.answer('set_grouping', { leaves: [{ setId, prKey: prs[1]!.key, reason: 'its risk is now high' }] });
    await h.engine.sync({ agentJobs: ['sets'] });

    expect(h.store.sets.get(setId)?.status).toBe('dissolved');
    expect(h.store.sets.get(setId)?.removedKeys).toEqual([prs[2]!.key]);
  });

  it('writes no history line for a rewrite that changes nothing', async () => {
    const prs = [reviewRequestedPr(1), reviewRequestedPr(2)];
    const { h, setId } = await depotWithSet(prs);
    h.store.glances.put(glance(prs[0]!.key, 'low - one line'));
    h.runner.answer('set_grouping', { updates: [{ setId, title: 'Runner switch', take: 'Both switch runners.' }] });

    await h.engine.sync({ agentJobs: ['sets'] });

    expect(changes(h).some((line) => line.startsWith('updated'))).toBe(false);
  });

  it('drops only the PR the user took out, so its former partner can still group with others', async () => {
    const h = makeHarness();
    const [a, c, d] = [1, 3, 4].map((n) => reviewRequestedPr(n));
    topicWithPrs(h, 'depot', [a!, c!, d!]);
    h.runner.answer('set_grouping', { newSets: [{ title: 'Pair', take: '', members: [member(a!), member(c!)] }] });
    await h.engine.sync({ agentJobs: ['sets'] });
    const pairId = h.store.sets.listActiveForTopic('depot')[0]!.id;
    await h.engine.giveFeedback({ kind: 'not_related', tileId: `set:${pairId}`, prKey: c!.key, targetTopicId: null, note: '' });

    h.runner.answer('set_grouping', { newSets: [{ title: 'Runner switch', take: '', members: [member(a!), member(c!), member(d!)] }] });
    await h.engine.sync({ agentJobs: ['sets'] });

    const created = h.store.sets.listActiveForTopic('depot');
    expect(created.map((set) => set.members.map((m) => m.prKey))).toEqual([[a!.key, d!.key]]);
  });

  it('ends a set whose PRs became one stack, without asking the agent', async () => {
    const x = reviewRequestedPr(1, { headRef: 'x1' });
    const y = reviewRequestedPr(2, { baseRef: 'main', headRef: 'y1' });
    const { h, setId } = await depotWithSet([x, y]);

    h.reader.addPr({ ...y, baseRef: 'x1', updatedAt: at(5) }, makeThreadFor(y));
    const report = await h.engine.sync({ agentJobs: ['sets'] });

    expect(report.agentCalls).toBe(0);
    expect(h.store.sets.get(setId)).toBeNull();
    expect(changes(h)[0]).toBe('ended - (rules): fewer than two PRs left');
  });

  it('regroups again after a PR left a set, so it can join another one', async () => {
    const prs = [reviewRequestedPr(1), reviewRequestedPr(2), reviewRequestedPr(3)];
    const { h, setId } = await depotWithSet(prs);
    h.runner.answer('set_grouping', { joins: [{ setId, prKey: prs[2]!.key, reason: 'same change' }] });
    h.store.glances.put(glance(prs[2]!.key, 'low - same'));
    await h.engine.sync({ agentJobs: ['sets'] });

    h.store.glances.put(glance(prs[2]!.key, 'high - migrations'));
    h.runner.answer('set_grouping', { leaves: [{ setId, prKey: prs[2]!.key, reason: 'its risk is now high' }] });
    await h.engine.sync({ agentJobs: ['sets'] });

    h.runner.answer('set_grouping', {});
    const report = await h.engine.sync({ agentJobs: ['sets'] });
    expect(report.agentCallStats.byKind.set_grouping?.calls).toBe(1);
  });
});

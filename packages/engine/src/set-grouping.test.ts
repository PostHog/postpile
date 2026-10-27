import type { FullPr, Glance, Pr } from '@postpile/core';
import { at, makeThreadFor } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness, NOW, type Harness } from './testing/fakes.ts';
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

  // Bug fixed 2026-10-10 (builder 12): the moved PR stayed in the old set tile until the next sync.
  it('takes a member the user moved to another topic out of the set at once', async () => {
    const prs = [reviewRequestedPr(1), reviewRequestedPr(2), reviewRequestedPr(3)];
    const { h, setId } = await depotWithSet(prs);
    h.runner.answer('set_grouping', { joins: [{ setId, prKey: prs[2]!.key, reason: 'same change' }] });
    h.store.glances.put(glance(prs[2]!.key, 'low - same'));
    await h.engine.sync({ agentJobs: ['sets'] });
    h.store.topics.create(makeTopic('billing'));

    await h.engine.giveFeedback({ kind: 'wrong_topic', tileId: `set:${setId}`, prKey: prs[2]!.key, targetTopicId: 'billing', note: '' });

    expect(h.store.sets.get(setId)?.members.map((m) => m.prKey)).toEqual([prs[0]!.key, prs[1]!.key]);
    expect(changes(h)[0]).toBe('left acme/app#3 (user): moved to another topic');
    const depot = (await h.engine.getTopic('depot'))?.tiles.flatMap((view) => view.tile.members.map((m) => m.prKey));
    expect(depot).not.toContain(prs[2]!.key);
    await h.engine.sync({ agentJobs: ['sets'] });
    expect(h.store.sets.get(setId)?.members.map((m) => m.prKey)).toEqual([prs[0]!.key, prs[1]!.key]);
  });

  it('ends a set of two when the user moves one of them away, also without a target', async () => {
    const prs = [reviewRequestedPr(1), reviewRequestedPr(2)];
    const { h, setId } = await depotWithSet(prs);

    await h.engine.giveFeedback({ kind: 'wrong_topic', tileId: `set:${setId}`, prKey: prs[1]!.key, targetTopicId: null, note: '' });

    expect(h.store.sets.get(setId)?.status).not.toBe('active');
    expect(changes(h).slice(0, 2)).toEqual(['ended - (user): fewer than two PRs left', 'left acme/app#2 (user): moved to another topic']);
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

const DAY_MS = 24 * 60 * 60 * 1000;

function mergedPr(pr: FullPr, mergedAt: string): FullPr {
  return { ...pr, state: 'MERGED', mergedAt, mergedBy: 'alice', updatedAt: mergedAt };
}

// Finished sets close, and sets cap at SET_MAX_MEMBERS (DESIGN.md "Tiles hold still", 2026-10-27).
describe('finished sets close', () => {
  /** "depot" with a set over #1 and #2, #3 and #4 open in no set, and a clock the test moves. */
  async function finishedSet(): Promise<{ h: Harness; setId: string; prs: FullPr[]; later: (days: number) => void }> {
    let now = NOW;
    const h = makeHarness({ now: () => now });
    const prs = [1, 2, 3, 4].map((n) => reviewRequestedPr(n));
    topicWithPrs(h, 'depot', prs);
    h.runner.answer('set_grouping', { newSets: [{ title: 'Runner switch', take: 'Both switch runners.', members: [member(prs[0]!), member(prs[1]!)] }] });
    await h.engine.sync({ agentJobs: ['sets'] });
    const setId = h.store.sets.listActiveForTopic('depot')[0]!.id;
    const mergedAt = new Date(NOW.getTime() - DAY_MS).toISOString();
    h.reader.addPr(mergedPr(prs[0]!, mergedAt), makeThreadFor(prs[0]!));
    h.reader.addPr(mergedPr(prs[1]!, mergedAt), makeThreadFor(prs[1]!));
    return { h, setId, prs, later: (days) => (now = new Date(NOW.getTime() + days * DAY_MS)) };
  }

  it('stays open for a quick follow-up the first two days', async () => {
    const { h, setId } = await finishedSet();
    await h.engine.sync({ agentJobs: ['sets'] });

    expect(h.store.sets.get(setId)?.closedAt).toBeNull();
    expect(changes(h).some((line) => line.startsWith('closed'))).toBe(false);
  });

  it('closes two days after the last merge, once, without asking the agent', async () => {
    const { h, setId, later } = await finishedSet();
    later(1);
    const report = await h.engine.sync({ agentJobs: ['sets'] });

    expect(report.agentCalls).toBe(0);
    expect(h.store.sets.get(setId)?.closedAt).toBe(new Date(NOW.getTime() + DAY_MS).toISOString());
    expect(changes(h)[0]).toBe('closed - (rules): every PR merged or closed 2 days ago');

    later(5);
    await h.engine.sync({ agentJobs: ['sets'] });
    expect(changes(h).filter((line) => line.startsWith('closed'))).toHaveLength(1);
  });

  it('stays open while a layer stacked onto a member later is still open', async () => {
    const { h, setId, prs, later } = await finishedSet();
    // #5 stacks onto #2 after the set was made: the tile shows it, the stored members do not hold it.
    const layer = reviewRequestedPr(5, { baseRef: prs[1]!.headRef, headRef: 'layer-5' });
    h.reader.addPr(layer, makeThreadFor(layer));
    h.store.memberships.assign({ prKey: layer.key, topicId: 'depot', assignedBy: 'user', reason: '', createdAt: at(0) });
    h.runner.answer('set_grouping', {});
    later(5);
    await h.engine.sync({ agentJobs: ['sets'] });

    expect(h.store.sets.get(setId)?.members.map((m) => m.prKey)).not.toContain(layer.key);
    expect(h.store.sets.get(setId)?.closedAt).toBeNull();
  });

  it('still shows as the same tile with the same members', async () => {
    const { h, setId, prs, later } = await finishedSet();
    later(1);
    await h.engine.sync({ agentJobs: ['sets'] });

    const tiles = (await h.engine.getTopic('depot'))?.tiles ?? [];
    const tile = tiles.find((view) => view.tile.id === `set:${setId}`);
    expect(tile?.tile.members.map((m) => m.prKey)).toEqual([prs[0]!.key, prs[1]!.key]);
  });

  it('is not offered to the agent, and a join into it is dropped', async () => {
    const { h, setId, prs, later } = await finishedSet();
    later(1);
    await h.engine.sync({ agentJobs: ['sets'] });

    h.store.glances.put(glance(prs[2]!.key, 'low - same switch'));
    h.runner.answer('set_grouping', {
      joins: [{ setId, prKey: prs[2]!.key, reason: 'a follow-up to the runner switch' }],
      updates: [{ setId, title: 'Runner switch again', take: 'Reopened.' }],
    });
    await h.engine.sync({ agentJobs: ['sets'] });

    const prompts = h.runner.promptsFor('set_grouping');
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).not.toContain(setId);
    const set = h.store.sets.get(setId);
    expect(set?.members.map((m) => m.prKey)).toEqual([prs[0]!.key, prs[1]!.key]);
    expect(set?.title).toBe('Runner switch');
  });
});

describe('sets cap at twelve members', () => {
  /** "depot" with `count` open PRs and one set over the first `size` of them. */
  async function bigSet(count: number, size: number): Promise<{ h: Harness; setId: string; prs: FullPr[] }> {
    const h = makeHarness();
    const prs = Array.from({ length: count }, (_, index) => reviewRequestedPr(index + 1));
    topicWithPrs(h, 'depot', prs);
    h.runner.answer('set_grouping', { newSets: [{ title: 'Version cap', take: '', members: prs.slice(0, size).map((pr) => member(pr)) }] });
    await h.engine.sync({ agentJobs: ['sets'] });
    return { h, setId: h.store.sets.listActiveForTopic('depot')[0]!.id, prs };
  }

  it('drops a join into a set of twelve, and marks it full in the prompt', async () => {
    const { h, setId, prs } = await bigSet(13, 12);
    h.store.glances.put(glance(prs[12]!.key, 'low - same cap'));
    h.runner.answer('set_grouping', { joins: [{ setId, prKey: prs[12]!.key, reason: 'same cap' }] });
    await h.engine.sync({ agentJobs: ['sets'] });

    expect(h.store.sets.get(setId)?.members).toHaveLength(12);
    expect(h.runner.promptsFor('set_grouping')[1]).toContain(`set id ${setId} (FULL: 12 PRs`);
  });

  it('counts a layer stacked onto a member later toward the cap', async () => {
    const { h, setId, prs } = await bigSet(12, 11);
    // #20 stacks onto #11 after the set was made: 11 stored members, 12 PRs on the tile.
    const layer = reviewRequestedPr(20, { baseRef: prs[10]!.headRef, headRef: 'layer-20' });
    h.reader.addPr(layer, makeThreadFor(layer));
    h.store.memberships.assign({ prKey: layer.key, topicId: 'depot', assignedBy: 'user', reason: '', createdAt: at(0) });
    h.store.glances.put(glance(prs[11]!.key, 'low - same cap'));
    h.runner.answer('set_grouping', { joins: [{ setId, prKey: prs[11]!.key, reason: 'same cap' }] });
    await h.engine.sync({ agentJobs: ['sets'] });

    expect(h.store.sets.get(setId)?.members).toHaveLength(11);
    expect(h.runner.promptsFor('set_grouping').at(-1)).toContain(`set id ${setId} (FULL: 12 PRs`);
  });

  it('keeps a new set the agent proposed too big to its first twelve', async () => {
    const { h, prs } = await bigSet(14, 14);
    const sets = h.store.sets.listActiveForTopic('depot');
    expect(sets.map((set) => set.members.map((m) => m.prKey))).toEqual([prs.slice(0, 12).map((pr) => pr.key)]);
  });

  it('drops a merge of two sets that together go past twelve', async () => {
    const h = makeHarness();
    const prs = Array.from({ length: 15 }, (_, index) => reviewRequestedPr(index + 1));
    topicWithPrs(h, 'depot', prs);
    h.runner.answer('set_grouping', {
      newSets: [
        { title: 'Version cap', take: '', members: prs.slice(0, 10).map((pr) => member(pr)) },
        { title: 'Version cap too', take: '', members: prs.slice(10, 13).map((pr) => member(pr)) },
      ],
    });
    await h.engine.sync({ agentJobs: ['sets'] });
    const created = h.store.sets.listActiveForTopic('depot');
    const big = created.find((set) => set.title === 'Version cap');
    const small = created.find((set) => set.title === 'Version cap too');

    h.store.glances.put(glance(prs[13]!.key, 'low - same cap'));
    h.runner.answer('set_grouping', { merges: [{ setId: small!.id, intoSetId: big!.id, reason: 'one version cap' }] });
    await h.engine.sync({ agentJobs: ['sets'] });

    expect(h.store.sets.get(big!.id)?.members).toHaveLength(10);
    expect(h.store.sets.get(small!.id)?.members).toHaveLength(3);
    expect(changes(h).some((line) => line.startsWith('merged'))).toBe(false);
  });
});

import type { Pr } from '@postpile/core';
import { at, makePr, makeThreadFor } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { makeTopic, topicWithPrs } from './testing/topics.ts';
import { changeTopicStatus } from './topic-status.ts';

/**
 * #1 (master <- s1) and #2 (s1 <- s2) are pinged, #3 (s2 <- s3) is a draft
 * nobody pinged, so the sync pulls it in. #4 is a lone pinged PR.
 */
function stackOfThree(): { bottom: Pr; middle: Pr; top: Pr; lone: Pr; stackId: string } {
  const bottom = reviewRequestedPr(1, { baseRef: 'master', headRef: 's1' });
  const middle = reviewRequestedPr(2, { baseRef: 's1', headRef: 's2' });
  const top = makePr({ number: 3, baseRef: 's2', headRef: 's3', isDraft: true });
  const lone = reviewRequestedPr(4);
  return { bottom, middle, top, lone, stackId: `stack:${bottom.key}` };
}

async function tileMembers(h: Harness, topicId: string): Promise<[string, string[]][]> {
  const tiles = (await h.engine.getTopic(topicId))?.tiles ?? [];
  return tiles.map((view) => [view.tile.id, view.tile.members.map((m) => m.prKey)]);
}

describe('a stack is one unit in topic assignment', () => {
  it('asks the agent about one layer per stack and gives every layer its answer', async () => {
    const h = makeHarness();
    const { bottom, middle, top, lone, stackId } = stackOfThree();
    for (const pr of [bottom, middle, lone]) {
      h.reader.addPr(pr, makeThreadFor(pr));
    }
    h.reader.addStackPr(top);
    h.runner.answer('topic_assignment', {
      assignments: [
        { prKey: bottom.key, kind: 'new', name: 'Depot', reason: 'runner move' },
        { prKey: lone.key, kind: 'new', name: 'Billing', reason: 'billing work' },
      ],
    });

    await h.engine.sync({ agentJobs: ['topics'] });

    const prompts = h.runner.promptsFor('topic_assignment');
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain(bottom.key);
    expect(prompts[0]).not.toContain(middle.key);
    const depot = h.store.memberships.get(bottom.key)?.topicId;
    expect(h.store.memberships.get(middle.key)?.topicId).toBe(depot);
    expect(h.store.memberships.get(top.key)).toBeNull();
    expect(await tileMembers(h, depot!)).toEqual([[stackId, [bottom.key, middle.key, top.key]]]);
  });

  it('puts a layer that gets pinged later into its stack topic without asking the agent', async () => {
    const h = makeHarness();
    const { bottom, middle, top } = stackOfThree();
    topicWithPrs(h, 'depot', [bottom, middle]);
    h.reader.addStackPr(top);
    await h.engine.sync({ maxAgentCalls: 0 });

    h.reader.addPr(top, makeThreadFor(top, { reason: 'mention', updatedAt: at(30) }));
    h.reader.etag = 'etag-2';
    await h.engine.sync({ agentJobs: ['topics'] });

    expect(h.runner.promptsFor('topic_assignment')).toEqual([]);
    expect(h.store.memberships.get(top.key)).toMatchObject({ topicId: 'depot', reason: 'joins its stack' });
  });

  it('brings a retired stack topic back when a new layer joins it', async () => {
    const h = makeHarness();
    const { bottom, middle, top } = stackOfThree();
    topicWithPrs(h, 'depot', [bottom, middle]);
    h.reader.addStackPr(top);
    await h.engine.sync({ maxAgentCalls: 0 });
    changeTopicStatus(h.store, 'depot', 'retire', at(20));

    h.reader.addPr(top, makeThreadFor(top, { reason: 'mention', updatedAt: at(30) }));
    h.reader.etag = 'etag-2';
    await h.engine.sync({ agentJobs: ['topics'] });

    expect(h.store.memberships.get(top.key)).toMatchObject({ topicId: 'depot', reason: 'joins its stack' });
    expect(h.store.topics.get('depot')?.status).toBe('active');
  });
});

describe('a stack is one unit on the board', () => {
  it('shows a stack whose layers sit in two topics once, in the topic of the newest membership', async () => {
    const h = makeHarness();
    const { bottom, middle, top, stackId } = stackOfThree();
    topicWithPrs(h, 'depot', [bottom]);
    topicWithPrs(h, 'billing', []);
    h.reader.addPr(middle, makeThreadFor(middle));
    h.store.memberships.assign({ prKey: middle.key, topicId: 'billing', assignedBy: 'agent', reason: '', createdAt: at(5) });
    h.reader.addStackPr(top);

    await h.engine.sync({ maxAgentCalls: 0 });

    expect(await tileMembers(h, 'depot')).toEqual([]);
    expect(await tileMembers(h, 'billing')).toEqual([[stackId, [bottom.key, middle.key, top.key]]]);
    expect((await h.engine.getPr(bottom.key))?.topicId).toBe('billing');
  });

  it('shows the stack in the active topic when the newest membership is in a retired one', async () => {
    const h = makeHarness();
    const { bottom, middle, top, stackId } = stackOfThree();
    topicWithPrs(h, 'depot', [bottom]);
    topicWithPrs(h, 'billing', []);
    h.reader.addPr(middle, makeThreadFor(middle));
    h.store.memberships.assign({ prKey: middle.key, topicId: 'billing', assignedBy: 'agent', reason: '', createdAt: at(5) });
    h.reader.addStackPr(top);
    await h.engine.sync({ maxAgentCalls: 0 });
    changeTopicStatus(h.store, 'billing', 'retire', at(10));

    expect(await tileMembers(h, 'depot')).toEqual([[stackId, [bottom.key, middle.key, top.key]]]);
    expect((await h.engine.getPr(middle.key))?.topicId).toBe('depot');
  });
});

describe('a stack is one unit in sets', () => {
  async function depotWithStack(): Promise<{ h: Harness; prs: ReturnType<typeof stackOfThree> }> {
    const h = makeHarness();
    const prs = stackOfThree();
    topicWithPrs(h, 'depot', [prs.bottom, prs.middle, prs.lone]);
    h.reader.addStackPr(prs.top);
    return { h, prs };
  }

  it('stores a set that names one layer with its whole stack, and drops a set that is only the stack', async () => {
    const { h, prs } = await depotWithStack();
    const { bottom, middle, top, lone } = prs;
    h.runner.answer('set_grouping', {
      newSets: [
        { title: 'Runner switch', take: 'Same rollout.', members: [{ prKey: lone.key, reason: 'a' }, { prKey: middle.key, reason: 'b' }] },
        { title: 'Just the stack', take: '', members: [{ prKey: bottom.key, reason: 'a' }, { prKey: middle.key, reason: 'b' }] },
      ],
    });

    await h.engine.sync({ agentJobs: ['sets'] });

    const sets = h.store.sets.listActiveForTopic('depot');
    expect(sets.map((set) => [set.title, set.members.map((m) => m.prKey)])).toEqual([['Runner switch', [lone.key, bottom.key, middle.key, top.key]]]);
    expect(await tileMembers(h, 'depot')).toEqual([[`set:${sets[0]!.id}`, [lone.key, bottom.key, middle.key, top.key]]]);
    const view = (await h.engine.getTopic('depot'))?.tiles[0];
    expect(view?.tile.stacks).toEqual([{ id: prs.stackId, prKeys: [bottom.key, middle.key, top.key] }]);
  });

  it('ends the set when "not related" leaves only one stack', async () => {
    const { h, prs } = await depotWithStack();
    const { middle, lone } = prs;
    h.runner.answer('set_grouping', {
      newSets: [{ title: 'Runner switch', take: '', members: [{ prKey: lone.key, reason: 'a' }, { prKey: middle.key, reason: 'b' }] }],
    });
    await h.engine.sync({ agentJobs: ['sets'] });
    const setId = h.store.sets.listActiveForTopic('depot')[0]!.id;

    await h.engine.giveFeedback({ kind: 'not_related', tileId: `set:${setId}`, prKey: lone.key, targetTopicId: null, note: '' });

    expect(h.store.sets.get(setId)?.status).toBe('dissolved');
    expect(h.store.sets.listChangesForTopic('depot', 5)[0]).toMatchObject({ kind: 'ended', by: 'user' });
  });

  it('keeps a stack in its set while the stack shows in the set\'s topic, whatever one layer\'s own membership says', async () => {
    const { h, prs } = await depotWithStack();
    const { bottom, middle, lone } = prs;
    h.runner.answer('set_grouping', {
      newSets: [{ title: 'Runner switch', take: '', members: [{ prKey: lone.key, reason: 'a' }, { prKey: middle.key, reason: 'b' }] }],
    });
    await h.engine.sync({ agentJobs: ['sets'] });
    const setId = h.store.sets.listActiveForTopic('depot')[0]!.id;
    // An older membership of the bottom layer points elsewhere; the stack still shows in depot (newest membership wins).
    h.store.topics.create(makeTopic('billing'));
    h.store.memberships.assign({ prKey: bottom.key, topicId: 'billing', assignedBy: 'agent', reason: '', createdAt: at(-5) });
    h.store.glances.put({ prKey: lone.key, verdict: 'LOOKS_SAFE', forYou: '', does: '', risk: 'low - x', othersSaid: '', keyFiles: [], pullInReason: null, dossierVersion: null, inputHash: 'h', model: 'm', createdAt: at(3) });
    h.runner.answer('set_grouping', {});

    await h.engine.sync({ agentJobs: ['sets'] });

    expect(h.store.sets.get(setId)?.status).toBe('active');
    expect(h.store.sets.get(setId)?.members.map((m) => m.prKey)).toContain(bottom.key);
  });

  it('takes the whole stack out on "not related" for one layer', async () => {
    const { h, prs } = await depotWithStack();
    const { middle, lone, stackId } = prs;
    h.runner.answer('set_grouping', {
      newSets: [{ title: 'Runner switch', take: '', members: [{ prKey: lone.key, reason: 'a' }, { prKey: middle.key, reason: 'b' }] }],
    });
    await h.engine.sync({ agentJobs: ['sets'] });
    const setId = h.store.sets.listActiveForTopic('depot')[0]!.id;

    await h.engine.giveFeedback({ kind: 'not_related', tileId: `set:${setId}`, prKey: middle.key, targetTopicId: null, note: '' });

    expect(h.store.sets.listActiveForTopic('depot')).toEqual([]);
    const tiles = await tileMembers(h, 'depot');
    expect(tiles.map(([id]) => id)).toEqual([stackId, `pr:${lone.key}`]);
  });
});

describe('a stack is one unit when the user moves it', () => {
  it('moves every tracked layer on "wrong topic" for one layer', async () => {
    const h = makeHarness();
    const { bottom, middle, top, stackId } = stackOfThree();
    topicWithPrs(h, 'depot', [bottom, middle]);
    h.store.topics.create(makeTopic('billing'));
    h.reader.addStackPr(top);
    await h.engine.sync({ maxAgentCalls: 0 });

    const result = await h.engine.giveFeedback({ kind: 'wrong_topic', tileId: stackId, prKey: middle.key, targetTopicId: 'billing', note: '' });

    expect(result.ok).toBe(true);
    expect(h.store.memberships.get(bottom.key)).toMatchObject({ topicId: 'billing', assignedBy: 'user' });
    expect(h.store.memberships.get(middle.key)).toMatchObject({ topicId: 'billing', assignedBy: 'user' });
    expect(h.store.memberships.get(top.key)).toBeNull();
    expect(await tileMembers(h, 'billing')).toEqual([[stackId, [bottom.key, middle.key, top.key]]]);
    expect(await tileMembers(h, 'depot')).toEqual([]);
  });
});

import type { FullPr } from '@postpile/core';
import { at, makeComment, makeCommit, makePr, makeThreadFor } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { topicWithPrs } from './testing/topics.ts';
import { STACK_DEPTH } from './stack-layers.ts';

/** A PR on the given branches with nothing that pings the viewer. */
function layer(number: number, baseRef: string, headRef: string, overrides: Partial<FullPr> = {}): FullPr {
  return makePr({ number, baseRef, headRef, ...overrides });
}

/**
 * #10 (master <- l10) <- #11 (pinged, in "depot") <- #12, all open.
 * Only #11 has a notification thread.
 */
function threeLayerStack(h: Harness): { below: FullPr; pinged: FullPr; above: FullPr } {
  const below = layer(10, 'master', 'l10', { comments: [makeComment({ id: 'c10', author: 'bob', body: 'rebased' })] });
  const pinged = reviewRequestedPr(11, { baseRef: 'l10', headRef: 'l11' });
  const above = layer(12, 'l11', 'l12');
  topicWithPrs(h, 'depot', [pinged]);
  h.reader.addStackPr(below);
  h.reader.addStackPr(above);
  return { below, pinged, above };
}

describe('stack layers', () => {
  it('fetches the missing layers by branch and records them as pulled in', async () => {
    const h = makeHarness();
    const { below, pinged, above } = threeLayerStack(h);

    const report = await h.engine.sync({ maxAgentCalls: 0 });

    expect(report.errors).toEqual([]);
    expect(report).toMatchObject({ prsFetched: 1, prsPulledIn: 2 });
    expect(h.store.pullIns.get(below.key)).toMatchObject({ anchorPrKey: pinged.key, reason: 'stack layer below #11' });
    expect(h.store.pullIns.get(above.key)).toMatchObject({ anchorPrKey: pinged.key, reason: 'stack layer above #11' });
    expect(h.reader.branchLookups[0]).toEqual([
      { repo: 'acme/app', branch: 'l10', side: 'head' },
      { repo: 'acme/app', branch: 'l11', side: 'base' },
    ]);

    const topic = await h.engine.getTopic('depot');
    const stack = topic?.tiles.find((view) => view.tile.kind === 'stack');
    expect(stack?.tile.members.map((m) => [m.prKey, m.provenance])).toEqual([
      [below.key, { kind: 'pulled_in', reason: 'stack layer below #11' }],
      [pinged.key, { kind: 'pinged', reason: 'review_requested' }],
      [above.key, { kind: 'pulled_in', reason: 'stack layer above #11' }],
    ]);
  });

  it('shows layers in the topic of the pinged PR and makes no agent calls for them', async () => {
    const h = makeHarness();
    const { below, pinged, above } = threeLayerStack(h);

    const report = await h.engine.sync();

    // Their events are logged, but only the pinged PR's count as new work.
    expect(report.newEvents).toBe(1);
    expect(h.store.eventLog.listSince([below.key], 0)).toHaveLength(1);
    expect((await h.engine.getPr(below.key))?.topicId).toBe('depot');
    expect((await h.engine.getPr(above.key))?.topicId).toBe('depot');
    expect(h.store.memberships.get(below.key)).toBeNull();
    // No topic assignment, glance, dossier or event call touches a layer.
    expect(h.runner.promptsFor('topic_assignment')).toEqual([]);
    expect(h.agent.glanceInputs.flatMap((input) => input.items.map((item) => item.pr.key))).toEqual([pinged.key]);
    expect(h.agent.dossierInputs.flatMap((input) => input.prs.map((pr) => pr.key))).toEqual([pinged.key]);
    expect(h.agent.eventInputs.flatMap((input) => input.items.map((item) => item.pr.key))).not.toContain(below.key);
    const listed = await h.engine.listTopics();
    expect(listed.map((item) => item.topic.id)).toEqual(['depot']);
  });

  it('walks at most STACK_DEPTH layers each way', async () => {
    const h = makeHarness();
    // Eight layers below the pinged PR: #1 on master, #2 on #1, ... #8 on #7.
    const layers = Array.from({ length: 8 }, (_, index) => layer(index + 1, index === 0 ? 'master' : `l${index}`, `l${index + 1}`));
    for (const pr of layers) {
      h.reader.addStackPr(pr);
    }
    const pinged = reviewRequestedPr(20, { baseRef: 'l8', headRef: 'l20' });
    topicWithPrs(h, 'depot', [pinged]);

    const report = await h.engine.sync({ maxAgentCalls: 0 });

    expect(report.prsPulledIn).toBe(STACK_DEPTH);
    expect(h.reader.branchLookups).toHaveLength(STACK_DEPTH);
    expect([...h.store.pullIns.listAll().keys()].sort()).toEqual(layers.slice(2).map((pr) => pr.key).sort());
  });

  it('takes merged layers of any age and closed layers, and stops at another seed', async () => {
    const h = makeHarness();
    const recent = layer(30, 'l29', 'l30', { state: 'MERGED', mergedAt: '2026-08-25T00:00:00.000Z', createdAt: '2026-08-20T00:00:00.000Z' });
    const old = layer(40, 'l39', 'l40', { state: 'MERGED', mergedAt: '2025-03-01T00:00:00.000Z', createdAt: '2025-02-01T00:00:00.000Z' });
    const closed = layer(50, 'l49', 'l50', { state: 'CLOSED', createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-09-01T12:00:00.000Z' });
    const otherPinged = reviewRequestedPr(60, { baseRef: 'master', headRef: 'l59' });
    h.reader.addStackPr(recent);
    h.reader.addStackPr(old);
    h.reader.addStackPr(closed);
    topicWithPrs(h, 'depot', [
      reviewRequestedPr(31, { baseRef: 'l30', headRef: 'l31', createdAt: '2026-08-21T00:00:00.000Z' }),
      reviewRequestedPr(41, { baseRef: 'l40', headRef: 'l41', createdAt: '2025-02-10T00:00:00.000Z' }),
      reviewRequestedPr(51, { baseRef: 'l50', headRef: 'l51', createdAt: '2026-08-21T00:00:00.000Z' }),
    ]);
    // #61 sits on #60, which has its own thread and is stored, so it walks its own stack.
    h.store.notifications.upsertMany([makeThreadFor(otherPinged)]);
    h.store.prs.upsert(otherPinged, otherPinged.updatedAt);
    h.reader.addStackPr(otherPinged);
    topicWithPrs(h, 'billing', [reviewRequestedPr(61, { baseRef: 'l59', headRef: 'l61' })]);

    await h.engine.sync({ maxAgentCalls: 0 });

    expect([...h.store.pullIns.listAll().keys()].sort()).toEqual([recent.key, old.key, closed.key].sort());
    // Every layer shows at the bottom of its stack, whatever its state or age.
    const topic = await h.engine.getTopic('depot');
    const stacks = topic?.tiles.filter((view) => view.tile.kind === 'stack') ?? [];
    expect(stacks.map((view) => view.prs.map((pr) => [pr.key, pr.status.lifecycle]))).toEqual([
      [
        [recent.key, 'merged'],
        ['acme/app#31', 'open'],
      ],
      [
        [old.key, 'merged'],
        ['acme/app#41', 'open'],
      ],
      [
        [closed.key, 'closed'],
        ['acme/app#51', 'open'],
      ],
    ]);
  });

  it('finds the merged layer after GitHub moved the PR above onto master, but not an old PR on a reused branch', async () => {
    const h = makeHarness();
    const merged = layer(70, 'master', 'l70', { state: 'MERGED', mergedAt: at(30) });
    const reused = layer(69, 'master', 'l71', { state: 'MERGED', mergedAt: '2025-01-01T00:00:00.000Z', createdAt: '2024-12-01T00:00:00.000Z' });
    h.reader.addStackPr(merged);
    h.reader.addStackPr(reused);
    const moved = reviewRequestedPr(71, { baseRef: 'master', headRef: 'l72', previousBaseRefs: ['l70'], createdAt: at(10) });
    const onReused = reviewRequestedPr(80, { baseRef: 'l71', headRef: 'l80', createdAt: at(10) });
    topicWithPrs(h, 'depot', [moved, onReused]);

    await h.engine.sync({ maxAgentCalls: 0 });

    expect([...h.store.pullIns.listAll().keys()]).toEqual([merged.key]);
    const topic = await h.engine.getTopic('depot');
    const stack = topic?.tiles.find((view) => view.tile.kind === 'stack');
    expect(stack?.tile.members.map((m) => m.prKey)).toEqual([merged.key, moved.key]);
  });

  it('walks the stacks of found PRs too, so their draft layers show', async () => {
    const h = makeHarness();
    const own = makePr({ number: 90, author: 'viewer', baseRef: 'master', headRef: 'l90' });
    const draft = layer(91, 'l90', 'l91', { isDraft: true, author: 'viewer' });
    h.reader.addFoundPr(own, 'own_open', 'your open PR');
    h.reader.addStackPr(draft);

    await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.store.pullIns.get(draft.key)).toMatchObject({ anchorPrKey: own.key, reason: 'stack layer above #90' });
    const tiles = (await h.engine.getTopic('unsorted'))?.tiles ?? [];
    expect(tiles.map((view) => [view.tile.kind, view.prs.map((pr) => pr.status.lifecycle)])).toEqual([['stack', ['open', 'draft']]]);
  });

  it('finds a layer opened on top later, though the PR below did not move', async () => {
    const h = makeHarness();
    const pinged = reviewRequestedPr(100, { baseRef: 'master', headRef: 'l100' });
    topicWithPrs(h, 'depot', [pinged]);
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.store.pullIns.listAll().size).toBe(0);

    const draft = layer(101, 'l100', 'l101', { isDraft: true });
    h.reader.addStackPr(draft);
    await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.store.pullIns.get(draft.key)).toMatchObject({ anchorPrKey: pinged.key });
    const stack = (await h.engine.getTopic('depot'))?.tiles.find((view) => view.tile.kind === 'stack');
    expect(stack?.tile.members.map((m) => m.prKey)).toEqual([pinged.key, draft.key]);
  });

  it('does not fetch a layer again when it has not moved, and a layer that gets pinged becomes pinged', async () => {
    const h = makeHarness();
    const { below, pinged } = threeLayerStack(h);
    await h.engine.sync({ maxAgentCalls: 0 });

    h.reader.addPr(pinged, makeThreadFor(pinged, { updatedAt: '2026-09-03T00:00:00.000Z' }));
    h.reader.etag = 'etag-2';
    const second = await h.engine.sync({ maxAgentCalls: 0 });
    expect(second).toMatchObject({ prsFetched: 1, prsPulledIn: 0 });

    h.reader.addPr(below, makeThreadFor(below, { reason: 'mention' }));
    h.reader.etag = 'etag-3';
    await h.engine.sync({ maxAgentCalls: 0 });
    const topic = await h.engine.getTopic('depot');
    const stack = topic?.tiles.find((view) => view.tile.kind === 'stack');
    expect(stack?.tile.members[0]?.provenance).toEqual({ kind: 'pinged', reason: 'mention' });
  });

  it('pulls in the layer below a body declares, and walks on below it by branch', async () => {
    const h = makeHarness();
    const bottom = layer(19, 'master', 'l19');
    const declared = layer(20, 'l19', 'l20', { isDraft: true });
    const pinged = reviewRequestedPr(21, { baseRef: 'master', headRef: 'l21', body: 'Stacked on #20; the GitHub diff includes its changes.' });
    topicWithPrs(h, 'depot', [pinged]);
    h.reader.addStackPr(bottom);
    h.reader.addStackPr(declared);

    const report = await h.engine.sync({ maxAgentCalls: 0 });

    expect(report.errors).toEqual([]);
    expect(h.reader.numberLookups).toEqual([[{ repo: 'acme/app', number: 20 }]]);
    expect(h.store.pullIns.get(declared.key)).toMatchObject({ anchorPrKey: pinged.key, reason: 'stack layer below #21, declared in its body' });
    expect(h.store.pullIns.get(bottom.key)).toMatchObject({ anchorPrKey: pinged.key, reason: 'stack layer below #21' });
    const topic = await h.engine.getTopic('depot');
    const stack = topic?.tiles.find((view) => view.tile.kind === 'stack');
    expect(stack?.tile.stacks).toEqual([{ id: `stack:${bottom.key}`, prKeys: [bottom.key, declared.key, pinged.key], declaredLinks: [pinged.key] }]);
  });

  it('tells the glance of a PR with a declared layer below what its diff owes that layer', async () => {
    const h = makeHarness();
    const declared = layer(20, 'master', 'l20', { isDraft: true, commits: [makeCommit({ oid: 'p1' })], files: [{ path: 'ci.yml', additions: 1, deletions: 0 }] });
    const pinged = reviewRequestedPr(21, {
      baseRef: 'master',
      headRef: 'l21',
      body: 'Stacked on #20',
      commits: [makeCommit({ oid: 'p1' }), makeCommit({ oid: 'c1' })],
      files: [
        { path: 'app.ts', additions: 4, deletions: 0 },
        { path: 'ci.yml', additions: 1, deletions: 0 },
      ],
    });
    topicWithPrs(h, 'depot', [pinged]);
    h.reader.addStackPr(declared);

    await h.engine.sync({ agentJobs: ['glances'] });

    const item = h.agent.glanceInputs.flatMap((input) => input.items).find((entry) => entry.pr.key === pinged.key);
    expect(item?.declaredParent).toEqual({ number: 20, state: 'draft', commits: 2, sharedCommits: 1, sharedFiles: ['ci.yml'] });
  });

  it('pulls in the PR a body depends on without making a stack, and links it once they share a commit', async () => {
    const h = makeHarness();
    const below = layer(19, 'master', 'l19');
    const dependency = layer(20, 'l19', 'l20', { commits: [makeCommit({ oid: 'api' })] });
    const pinged = reviewRequestedPr(21, { baseRef: 'master', headRef: 'l21', body: 'Depends on #20 for the new endpoint.', commits: [makeCommit({ oid: 'ui' })] });
    topicWithPrs(h, 'depot', [pinged]);
    h.reader.addStackPr(below);
    h.reader.addStackPr(dependency);

    await h.engine.sync({ agentJobs: ['glances'] });

    expect(h.store.pullIns.get(dependency.key)).toMatchObject({ anchorPrKey: pinged.key, reason: '#21 depends on it' });
    // A merge order says nothing about the dependency's own stack.
    expect(h.store.pullIns.get(below.key)).toBeNull();
    const topic = await h.engine.getTopic('depot');
    expect(topic?.tiles.map((view) => view.tile.kind)).toEqual(['single']);
    const item = h.agent.glanceInputs.flatMap((input) => input.items).find((entry) => entry.pr.key === pinged.key);
    expect(item?.dependsOn).toMatchObject({ number: 20 });
    expect(item?.declaredParent).toBeUndefined();

    // The branch turns out to carry #20's commit: the next read links them, no extra step.
    const rebuilt = { ...pinged, updatedAt: at(30), commits: [makeCommit({ oid: 'api' }), makeCommit({ oid: 'ui' })] };
    h.store.prs.upsert(rebuilt, at(30));
    const later = await h.engine.getTopic('depot');
    const stack = later?.tiles.find((view) => view.tile.kind === 'stack');
    expect(stack?.tile.stacks).toEqual([{ id: `stack:${dependency.key}`, prKeys: [dependency.key, pinged.key], declaredLinks: [pinged.key] }]);

    // And the next sync walks on below it, now a layer.
    h.reader.addStackPr(rebuilt);
    await h.engine.sync({ maxAgentCalls: 0 });
    expect(h.store.pullIns.get(dependency.key)).toMatchObject({ reason: 'stack layer below #21, declared in its body' });
    expect(h.store.pullIns.get(below.key)).toMatchObject({ reason: 'stack layer below #21' });
  });
});

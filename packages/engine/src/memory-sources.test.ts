import { emptyDossier } from '@postpile/core';
import { at, makeComment, makeDossierVersion, makeFact, makeFactRef } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { topicWithPrs } from './testing/topics.ts';

const pr = reviewRequestedPr(1, {
  headOid: 'h2',
  comments: [makeComment({ id: 'c1', author: 'lyra', body: 'Does the warm-up need a flag?' })],
});
const commentRef = makeFactRef({ kind: 'comment', prKey: pr.key, sourceId: 'c1' });

async function setup() {
  const h = makeHarness();
  topicWithPrs(h, 'depot', [pr]);
  await h.engine.sync({ maxAgentCalls: 0 });
  h.store.dossiers.add(
    makeDossierVersion({
      topicId: 'depot',
      version: 1,
      createdAt: at(50),
      dossier: {
        ...emptyDossier(),
        goal: 'Run CI on Depot',
        status: 'active',
        statusNote: 'waiting on the warm-up',
        statusSources: { refs: [{ ...commentRef, headOid: 'h1' }], userRefs: [] },
        userCares: [{ text: 'Cache keys', source: 'tailoring', userRefs: [{ kind: 'tailoring', id: 'depot', at: at(5), quote: 'Flag cache keys.' }] }],
        openQuestions: [{ text: 'Flag for the warm-up?', askedBy: 'lyra', refs: [commentRef] }],
      },
    }),
  );
  return h;
}

describe('getMemorySources', () => {
  it('lists who said what behind a dossier line and checks it against GitHub', async () => {
    const h = await setup();

    const question = await h.engine.getMemorySources({ kind: 'dossier_line', topicId: 'depot', version: 1, path: 'openQuestions[0]' });

    expect(question).toMatchObject({ claim: 'Flag for the warm-up?', recordedIn: 'Dossier v1', check: { state: 'ok' } });
    expect(question?.sources).toEqual([
      expect.objectContaining({ kind: 'comment', who: 'lyra', title: 'commented on #1', excerpt: 'Does the warm-up need a flag?', missing: false }),
    ]);
  });

  it('says when a status line is stale because the head moved since', async () => {
    const h = await setup();
    const status = await h.engine.getMemorySources({ kind: 'dossier_line', topicId: 'depot', version: 1, path: 'status' });
    expect(status?.check).toEqual({ state: 'stale', reason: 'head_moved', note: null });
  });

  it('shows the user own words, and lines without sources as unsourced', async () => {
    const h = await setup();

    const care = await h.engine.getMemorySources({ kind: 'dossier_line', topicId: 'depot', version: 1, path: 'userCares[0]' });
    const goal = await h.engine.getMemorySources({ kind: 'dossier_line', topicId: 'depot', version: 1, path: 'goal' });

    expect(care?.sources.map((source) => [source.title, source.excerpt])).toEqual([['Your instructions for this topic', 'Flag cache keys.']]);
    expect(care?.check.state).toBe('user_only');
    expect(goal).toMatchObject({ sources: [], check: { state: 'unsourced' } });
  });

  it('explains a fact and its verify state', async () => {
    const h = await setup();
    h.store.facts.add(makeFact({ id: 'f1', topicId: 'depot', text: 'lyra asked about the warm-up', predicate: 'note', object: null, refs: [commentRef] }));

    const fact = await h.engine.getMemorySources({ kind: 'fact', factId: 'f1' });

    expect(fact).toMatchObject({ claim: 'lyra asked about the warm-up', recordedIn: 'Fact', check: { state: 'ok' } });
    expect(fact?.sources[0]).toMatchObject({ who: 'lyra', title: 'commented on #1' });
  });

  it('returns null for unknown targets', async () => {
    const h = await setup();
    expect(await h.engine.getMemorySources({ kind: 'fact', factId: 'nope' })).toBeNull();
    expect(await h.engine.getMemorySources({ kind: 'dossier_line', topicId: 'depot', version: 9, path: 'goal' })).toBeNull();
    expect(await h.engine.getMemorySources({ kind: 'dossier_line', topicId: 'depot', version: 1, path: 'people[0]' })).toBeNull();
  });
});

import { makeFact, makeFactRef } from '@code-manager/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness, NOW, type Harness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { topicWithPrs } from './testing/topics.ts';

const LATER = '2026-09-03T00:00:00.000Z';

/** A harness whose clock the test can move. */
function movableHarness(): { h: Harness; setNow: (iso: string) => void } {
  let now = NOW;
  const h = makeHarness({ now: () => now });
  return { h, setNow: (iso) => (now = new Date(iso)) };
}

describe('correctMemory', () => {
  it('closes a fact marked wrong and logs what it said', async () => {
    const h = makeHarness();
    const pr = reviewRequestedPr(1);
    topicWithPrs(h, 'depot', [pr]);
    h.store.facts.add(makeFact({ id: 'f1', topicId: 'depot', text: 'alice drives the rollout', refs: [makeFactRef({ prKey: pr.key })] }));

    const result = await h.engine.correctMemory({ kind: 'wrong', factId: 'f1', topicId: null, text: 'ignored' });

    expect(result.ok).toBe(true);
    expect(h.store.facts.get('f1')).toMatchObject({ invalidReason: 'the user said it is wrong' });
    expect(h.store.facts.listActiveTouchingPrs([pr.key])).toEqual([]);
    expect(h.store.feedback.recentForTopic('depot', 5)[0]).toMatchObject({ kind: 'memory_wrong', prKey: pr.key, note: 'alice drives the rollout' });
  });

  it('logs a dossier line marked wrong and hands it to the next dossier update', async () => {
    const { h, setNow } = movableHarness();
    topicWithPrs(h, 'depot', [reviewRequestedPr(1)]);
    await h.engine.sync({ agentJobs: ['dossiers'] });

    setNow(LATER);
    const result = await h.engine.correctMemory({ kind: 'forget', factId: null, topicId: 'depot', text: 'CI cost' });
    expect(result.ok).toBe(true);
    expect((await h.engine.getTopic('depot'))?.dossier?.correctedClaims).toEqual(['CI cost']);

    h.reader.etag = 'etag-2';
    await h.engine.sync({ agentJobs: ['dossiers'] });

    expect(h.agent.dossierInputs[1]?.delta.newFeedback.map((entry) => [entry.kind, entry.note])).toEqual([['memory_forget', 'CI cost']]);
    const dossier = (await h.engine.getTopic('depot'))?.dossier;
    expect(dossier?.correctedClaims).toEqual([]);
    expect(dossier?.history.map((note) => note.version)).toEqual([2, 1]);
  });

  it('refuses unknown facts and topics', async () => {
    const h = makeHarness();
    expect((await h.engine.correctMemory({ kind: 'wrong', factId: 'nope', topicId: null, text: '' })).ok).toBe(false);
    expect((await h.engine.correctMemory({ kind: 'wrong', factId: null, topicId: 'nope', text: '' })).ok).toBe(false);
  });
});

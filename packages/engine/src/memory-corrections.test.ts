import { makeFact, makeFactRef, viewer } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness, NOW, type Harness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { topicWithPrs } from './testing/topics.ts';
import { RECHECKS_PER_DAY } from './memory/memory-recheck.ts';
import { saveViewer } from './viewer-meta.ts';

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

describe('accepting a recheck', () => {
  function withFact(h: Harness) {
    const pr = reviewRequestedPr(1);
    topicWithPrs(h, 'depot', [pr]);
    const fact = makeFact({ id: 'f1', topicId: 'depot', text: 'alice drives the rollout', staleAt: NOW.toISOString(), staleReason: 'head_moved', refs: [makeFactRef({ prKey: pr.key })] });
    h.store.facts.add(fact);
    return { pr, fact };
  }

  it('confirms a fact: no longer stale, logged, undoable', async () => {
    const h = makeHarness();
    const { fact } = withFact(h);
    const result = await h.engine.correctMemory({ kind: 'confirm', factId: 'f1', topicId: null, text: fact.text });
    expect(result).toMatchObject({ ok: true, message: 'Kept that fact' });
    expect(h.store.facts.get('f1')).toMatchObject({ staleAt: null, verifiedAt: NOW.toISOString() });
    expect(h.store.feedback.recentForTopic('depot', 5)[0]).toMatchObject({ kind: 'memory_confirmed', note: fact.text });

    expect((await h.engine.undo(result.undoToken)).ok).toBe(true);
    expect(h.store.facts.get('f1')).toEqual(fact);
    expect(h.store.feedback.recentForTopic('depot', 5)).toEqual([]);
  });

  it('replaces a fact with the fix, same refs, and undo brings the old one back', async () => {
    const h = makeHarness();
    const { pr, fact } = withFact(h);
    const result = await h.engine.correctMemory({ kind: 'fix', factId: 'f1', topicId: null, text: fact.text, fixedText: 'bob drives the rollout' });
    const [active] = h.store.facts.listActiveTouchingPrs([pr.key]);
    expect(active).toMatchObject({ text: 'bob drives the rollout', source: 'agent', refs: fact.refs, staleAt: null });
    expect(h.store.facts.get('f1')).toMatchObject({ supersededBy: active?.id });
    expect(h.store.feedback.recentForTopic('depot', 5)[0]).toMatchObject({ kind: 'memory_fixed', note: 'alice drives the rollout\n→ bob drives the rollout' });

    await h.engine.undo(result.undoToken);
    expect(h.store.facts.listActiveTouchingPrs([pr.key]).map((f) => f.id)).toEqual(['f1']);
    expect(h.store.feedback.recentForTopic('depot', 5)).toEqual([]);
  });

  it('undoes a wrong within the window only', async () => {
    const { h, setNow } = movableHarness();
    withFact(h);
    const first = await h.engine.correctMemory({ kind: 'wrong', factId: 'f1', topicId: null, text: '' });
    await h.engine.undo(first.undoToken);
    expect(h.store.facts.get('f1')?.invalidAt).toBeNull();

    const second = await h.engine.correctMemory({ kind: 'wrong', factId: 'f1', topicId: null, text: '' });
    setNow('2026-09-02T12:00:07Z');
    expect(await h.engine.undo(second.undoToken)).toMatchObject({ ok: false, message: 'undo window closed' });
    expect(h.store.facts.get('f1')?.invalidAt).not.toBeNull();
  });

  it('shows a fixed dossier line as fixed until the next update', async () => {
    const { h, setNow } = movableHarness();
    topicWithPrs(h, 'depot', [reviewRequestedPr(1)]);
    await h.engine.sync({ agentJobs: ['dossiers'] });
    setNow(LATER);
    await h.engine.correctMemory({ kind: 'fix', factId: null, topicId: 'depot', text: 'Goal: ship', fixedText: 'Goal: ship on Depot' });
    expect((await h.engine.getTopic('depot'))?.dossier?.fixedClaims).toEqual([{ text: 'Goal: ship', fixed: 'Goal: ship on Depot' }]);
  });
});

describe('recheckMemory', () => {
  it('asks the agent once with the line and its PRs, and records the call as an action', async () => {
    const h = makeHarness();
    const pr = reviewRequestedPr(1);
    topicWithPrs(h, 'depot', [pr]);
    await h.engine.sync({ maxAgentCalls: 0 });
    h.store.facts.add(makeFact({ id: 'f1', topicId: 'depot', text: 'alice drives the rollout', refs: [makeFactRef({ prKey: pr.key })] }));
    h.runner.answer('memory_recheck', { outcome: 'drop', text: '', why: 'bob took over.' });

    const result = await h.engine.recheckMemory({ factId: 'f1', topicId: null, text: 'alice drives the rollout', target: { kind: 'fact', factId: 'f1' } });

    expect(result).toEqual({ status: 'answered', outcome: 'drop', text: 'alice drives the rollout', why: 'bob took over.' });
    expect(h.runner.promptsFor('memory_recheck')[0]).toContain(pr.key);
    expect(h.store.agentCalls.countSince('memory_recheck', '2000-01-01')).toBe(1);
    expect(h.store.facts.get('f1')?.invalidAt).toBeNull();
  });

  it('says so when the agent fails, the fact is gone, or the daily cap is reached', async () => {
    const h = makeHarness();
    saveViewer(h.store, viewer);
    topicWithPrs(h, 'depot', [reviewRequestedPr(1)]);
    const line = { factId: null, topicId: 'depot', text: 'CI cost', target: null };
    expect(await h.engine.recheckMemory(line)).toMatchObject({ status: 'unavailable', reason: 'failed' });
    expect(await h.engine.recheckMemory({ ...line, factId: 'nope' })).toMatchObject({ status: 'unavailable', reason: 'not_found' });
    const call = { runId: 'action', topicId: null, model: 'sonnet', ok: true, attempt: 1, durationMs: 1, costUsd: null, at: NOW.toISOString() };
    for (let i = 0; i < RECHECKS_PER_DAY; i += 1) {
      h.store.agentCalls.add({ ...call, kind: 'memory_recheck' });
    }
    expect(await h.engine.recheckMemory(line)).toMatchObject({ status: 'unavailable', reason: 'budget' });
  });
});

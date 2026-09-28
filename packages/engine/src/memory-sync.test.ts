import type { Dossier, Pr } from '@postpile/core';
import { at, makeCandidate, makeComment, makeFact, makeFactRef, makeThreadFor } from '@postpile/core/fixtures';
import { describe, expect, it, vi } from 'vitest';
import { makeHarness, NOW, type Harness } from './testing/fakes.ts';
import { FAKE_MODEL } from './testing/fake-agent.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { topicWithPrs } from './testing/topics.ts';

const LATER = '2026-09-03T00:00:00.000Z';

/** A harness whose clock the test can move. */
function movableHarness(): { h: Harness; setNow: (iso: string) => void } {
  let now = NOW;
  const h = makeHarness({ now: () => now });
  return { h, setNow: (iso) => (now = new Date(iso)) };
}

/** Puts a newer snapshot of the PR in the fake reader, with a thread that moved so the next sync fetches it. */
function pushSnapshot(h: Harness, pr: Pr, etag: string): void {
  h.reader.addPr(pr, makeThreadFor(pr, { updatedAt: LATER }));
  h.reader.etag = etag;
}

function depotDossier(): Dossier {
  return {
    goal: 'Run CI on Depot',
    summary: 'Moving runners.',
    status: 'active',
    statusNote: '',
    people: [],
    openQuestions: [],
    timeline: [{ prKey: 'PostHog/posthog#1', role: 'first step' }],
    earlier: '',
    userCares: [],
    recentChanges: [],
  };
}

describe('dossier updates', () => {
  it('reads only the events that arrived since the last dossier', async () => {
    const { h, setNow } = movableHarness();
    const pr = reviewRequestedPr(1);
    topicWithPrs(h, 'depot', [pr]);

    await h.engine.sync({ agentJobs: ['dossiers'] });
    expect(h.agent.dossierInputs[0]?.delta.events.map((e) => e.kind)).toEqual(['review_requested']);

    setNow(LATER);
    const commented = { ...pr, comments: [makeComment({ id: 'c9', author: 'bob', body: 'what about cache keys?', createdAt: at(30) })] };
    pushSnapshot(h, commented, 'etag-2');
    const report = await h.engine.sync({ agentJobs: ['dossiers'] });

    expect(report.errors).toEqual([]);
    expect(report.dossiersUpdated).toBe(1);
    const second = h.agent.dossierInputs[1];
    expect(second?.previous?.version).toBe(1);
    expect(second?.delta.fromSeq).toBe(1);
    expect(second?.delta.events.map((e) => e.sourceId)).toEqual(['c9']);
    expect(second?.delta.joinedPrKeys).toEqual([]);
    const detail = await h.engine.getTopic('depot');
    expect(detail?.dossier).toMatchObject({ version: 2, eventsBehind: 0 });
    expect(detail?.topic.summary).toBe('depot: 1 new events');
  });

  it('reads the older events of a PR that joins an existing topic', async () => {
    const { h, setNow } = movableHarness();
    const pr1 = reviewRequestedPr(1);
    const pr2 = reviewRequestedPr(2);
    topicWithPrs(h, 'depot', [pr1]);
    h.reader.addPr(pr2, makeThreadFor(pr2));
    await h.engine.sync({ agentJobs: ['dossiers'] });
    // A newer event on the old member moves the digest cursor past everything pr2 logged.
    setNow(LATER);
    pushSnapshot(h, { ...pr1, comments: [makeComment({ id: 'c5', createdAt: at(30) })] }, 'etag-2');
    await h.engine.sync({ agentJobs: ['dossiers'] });

    setNow('2026-09-04T00:00:00.000Z');
    h.store.memberships.assign({ prKey: pr2.key, topicId: 'depot', assignedBy: 'user', reason: '', createdAt: '2026-09-04T00:00:00.000Z' });
    const report = await h.engine.sync({ agentJobs: ['dossiers'] });

    expect(report.errors).toEqual([]);
    const third = h.agent.dossierInputs[2];
    expect(third?.delta.joinedPrKeys).toEqual([pr2.key]);
    expect(third?.delta.events.map((e) => [e.prKey, e.kind])).toEqual([[pr2.key, 'review_requested']]);
  });

  it('makes no call for a topic without new input', async () => {
    const h = makeHarness();
    topicWithPrs(h, 'depot', [reviewRequestedPr(1)]);
    await h.engine.sync({ agentJobs: ['dossiers'] });

    h.reader.etag = 'etag-2';
    const report = await h.engine.sync({ agentJobs: ['dossiers'] });

    expect(report.agentCalls).toBe(0);
    expect(h.agent.dossierInputs).toHaveLength(1);
  });

  it('refreshes a dossier once when the tailoring changes, even without new events', async () => {
    const h = makeHarness();
    topicWithPrs(h, 'depot', [reviewRequestedPr(1)]);
    await h.engine.sync({ agentJobs: ['dossiers'] });

    h.store.topics.setTailoring('depot', 'Flag cache key changes.', at(5));
    h.reader.etag = 'etag-2';
    const refreshed = await h.engine.sync({ agentJobs: ['dossiers'] });
    h.reader.etag = 'etag-3';
    const quiet = await h.engine.sync({ agentJobs: ['dossiers'] });

    expect(refreshed.dossiersUpdated).toBe(1);
    expect(h.agent.dossierInputs[1]?.context.tailoring).toBe('Flag cache key changes.');
    expect(quiet.agentCalls).toBe(0);
  });

  it('lets the dossier driver win over the most frequent author', async () => {
    const h = makeHarness();
    topicWithPrs(h, 'depot', [reviewRequestedPr(1)]);
    h.agent.answerDossier(() => ({
      dossier: { ...depotDossier(), people: [{ login: 'carol', role: 'driver', note: 'owns it' }] },
    }));

    await h.engine.sync({ agentJobs: ['dossiers'] });

    expect(h.store.topics.get('depot')?.driver).toBe('carol');
  });

  it('reports a broken dossier answer and still writes glances', async () => {
    const h = makeHarness();
    const pr = reviewRequestedPr(1);
    topicWithPrs(h, 'depot', [pr]);
    h.agent.answerDossier(() => {
      throw new Error('bad json');
    });

    const report = await h.engine.sync({ agentJobs: ['dossiers', 'glances'] });

    expect(report.errors).toEqual(['dossier depot: bad json']);
    expect(report.agentCallStats.byKind.dossier_update).toMatchObject({ calls: 1, failed: 1 });
    expect((await h.engine.getPr(pr.key))?.glance?.dossierVersion).toBeNull();
  });
});

describe('the call cap', () => {
  it('spends the budget on dossiers first, then on glances', async () => {
    const h = makeHarness();
    topicWithPrs(h, 'depot', [reviewRequestedPr(1)]);
    topicWithPrs(h, 'billing', [reviewRequestedPr(2)]);

    const report = await h.engine.sync({ maxAgentCalls: 3, agentJobs: ['dossiers', 'glances'] });

    expect(report.agentCallStats.byKind.dossier_update?.calls).toBe(2);
    expect(report.agentCallStats.byKind.glance_batch).toMatchObject({ calls: 1, skippedByBudget: 1 });
    expect(report.agentCalls).toBe(3);
  });
});

describe('scheduling', () => {
  it("starts a topic's glances when its own dossier lands, not after every dossier", async () => {
    const h = makeHarness();
    const depot = reviewRequestedPr(1);
    const billing = reviewRequestedPr(2);
    topicWithPrs(h, 'depot', [depot]);
    topicWithPrs(h, 'billing', [billing]);
    const release = h.agent.holdDossier('billing');

    const syncing = h.engine.sync({ agentJobs: ['dossiers', 'glances'] });
    await vi.waitFor(() => expect(h.agent.glanceInputs).toHaveLength(1));
    expect(h.agent.glanceInputs[0]?.topic?.id).toBe('depot');
    release();
    await syncing;

    expect(h.agent.glanceInputs.map((input) => [input.topic?.id, input.dossier?.version])).toEqual([
      ['depot', 1],
      ['billing', 1],
    ]);
  });
});

describe('batched glances', () => {
  it('puts PRs the answer left out into one retry batch', async () => {
    const h = makeHarness();
    const prs = [reviewRequestedPr(1), reviewRequestedPr(2), reviewRequestedPr(3)];
    topicWithPrs(h, 'depot', prs);
    h.agent.answerGlances((input) => {
      const all = h.agent.allGlances(input);
      return { glances: all.glances.slice(0, 1), missing: input.items.slice(1).map((i) => i.pr.key), model: FAKE_MODEL };
    });

    const report = await h.engine.sync({ agentJobs: ['glances'] });

    expect(report.errors).toEqual([]);
    expect(h.agent.glanceInputs.map((input) => [input.attempt, input.items.length])).toEqual([
      [1, 3],
      [2, 2],
    ]);
    expect(report.agentCallStats.byKind.glance_batch).toMatchObject({ calls: 2, retries: 1 });
    expect(h.store.glances.getMany(prs.map((pr) => pr.key)).size).toBe(3);
  });

  it('reports PRs still missing after the retry', async () => {
    const h = makeHarness();
    const pr = reviewRequestedPr(1);
    topicWithPrs(h, 'depot', [pr]);
    const nothing = (input: { items: { pr: Pr }[] }) => ({ glances: [], missing: input.items.map((i) => i.pr.key), model: FAKE_MODEL });
    h.agent.answerGlances(nothing).answerGlances(nothing);

    const report = await h.engine.sync({ agentJobs: ['glances'] });

    expect(report.errors).toEqual([`glance ${pr.key}: missing or invalid in the answer`]);
    expect(h.store.glances.get(pr.key)).toBeNull();
  });

  it('leaves claims that fail verification out of the glance prompt', async () => {
    const h = makeHarness();
    const pr = reviewRequestedPr(1);
    topicWithPrs(h, 'depot', [pr]);
    const gone = { text: 'still open?', askedBy: null, refs: [makeFactRef({ kind: 'comment', sourceId: 'deleted' })] };
    const dossier = {
      ...depotDossier(),
      openQuestions: [gone],
      timeline: [...depotDossier().timeline, { prKey: 'PostHog/posthog#9', role: 'left' }],
    };
    h.store.dossiers.add({ topicId: 'depot', version: 1, dossier, flags: [], inputHash: 'h', throughSeq: 0, model: FAKE_MODEL, createdAt: at(0) });

    await h.engine.sync({ agentJobs: ['glances'] });

    const sent = h.agent.glanceInputs[0]?.dossier?.dossier;
    expect(sent?.openQuestions).toEqual([]);
    expect(sent?.timeline.map((entry) => entry.prKey)).toEqual([pr.key]);
  });

  it('writes glances against the new dossier version', async () => {
    const h = makeHarness();
    const pr = reviewRequestedPr(1);
    topicWithPrs(h, 'depot', [pr]);

    await h.engine.sync({ agentJobs: ['dossiers', 'glances'] });

    expect(h.agent.glanceInputs[0]?.dossier?.version).toBe(1);
    expect((await h.engine.getPr(pr.key))?.glanceStale).toBe(false);
  });
});

describe('facts', () => {
  it('adds new facts from the dossier update and shows them on the PR', async () => {
    const h = makeHarness();
    const pr = reviewRequestedPr(1);
    topicWithPrs(h, 'depot', [pr]);
    h.agent.answerDossier(() => ({ facts: [makeCandidate()] }));

    const report = await h.engine.sync({ agentJobs: ['dossiers'] });

    expect(report.facts.added).toBe(1);
    const facts = (await h.engine.getPr(pr.key))?.facts ?? [];
    expect(facts.map((view) => [view.fact.text, view.fact.topicId, view.stale])).toEqual([
      ['alice works on PostHog/posthog#1', 'depot', null],
    ]);
    const byPerson = await h.engine.listFacts({ entity: { kind: 'person', key: 'alice' } });
    expect(byPerson).toHaveLength(1);
  });

  it('closes a works_on fact once its PR merged', async () => {
    const { h, setNow } = movableHarness();
    const pr = reviewRequestedPr(1);
    topicWithPrs(h, 'depot', [pr]);
    h.agent.answerDossier(() => ({ facts: [makeCandidate()] }));
    await h.engine.sync({ agentJobs: ['dossiers'] });

    setNow(LATER);
    pushSnapshot(h, { ...pr, state: 'MERGED', mergedAt: at(90), mergedBy: 'alice' }, 'etag-2');
    const report = await h.engine.sync({ maxAgentCalls: 0 });

    expect(report.facts.invalidated).toBe(1);
    expect((await h.engine.getPr(pr.key))?.facts).toEqual([]);
    const closed = await h.engine.listFacts({ includeClosed: true });
    expect(closed[0]?.fact).toMatchObject({ invalidAt: at(90), invalidReason: 'pr_merged' });
  });

  it('replaces the old driver of an initiative without asking the agent', async () => {
    const { h, setNow } = movableHarness();
    const pr = reviewRequestedPr(1);
    topicWithPrs(h, 'depot', [pr]);
    const drives = (login: string, minute: number) =>
      makeCandidate({
        subject: { kind: 'person', key: login },
        predicate: 'drives',
        object: { kind: 'initiative', key: 'depot' },
        text: `${login} drives the Depot move`,
        validFrom: at(minute),
      });
    h.agent.answerDossier(() => ({ facts: [drives('alice', 20)] }));
    await h.engine.sync({ agentJobs: ['dossiers'] });

    setNow(LATER);
    pushSnapshot(h, { ...pr, comments: [makeComment({ id: 'c2' })] }, 'etag-2');
    h.agent.answerDossier(() => ({ facts: [drives('bob', 40)] }));
    const report = await h.engine.sync({ agentJobs: ['dossiers'] });

    expect(report.errors).toEqual([]);
    expect(h.agent.reconcileInputs).toHaveLength(0);
    expect(report.facts.updated).toBe(1);
    const active = await h.engine.listFacts({ predicate: 'drives' });
    expect(active.map((view) => view.fact.text)).toEqual(['bob drives the Depot move']);
  });

  it('asks the agent only about candidates the rules cannot settle', async () => {
    const { h, setNow } = movableHarness();
    const pr = reviewRequestedPr(1);
    topicWithPrs(h, 'depot', [pr]);
    h.agent.answerDossier(() => ({ facts: [makeCandidate()] }));
    await h.engine.sync({ agentJobs: ['dossiers'] });
    const [first] = await h.engine.listFacts({});

    setNow(LATER);
    pushSnapshot(h, { ...pr, comments: [makeComment({ id: 'c2' })] }, 'etag-2');
    h.agent.answerDossier(() => ({ facts: [makeCandidate({ text: 'alice reworks the runner image in #1' })] }));
    h.agent.answerReconcile((input) => [
      { kind: 'update', factId: first!.fact.id, candidate: input.items[0]!.candidate, reason: 'more precise' },
    ]);
    const report = await h.engine.sync({ agentJobs: ['dossiers'] });

    expect(report.errors).toEqual([]);
    expect(h.agent.reconcileInputs).toHaveLength(1);
    expect(report.facts.updated).toBe(1);
    const active = await h.engine.listFacts({});
    expect(active.map((view) => [view.fact.text, view.fact.topicId])).toEqual([['alice reworks the runner image in #1', 'depot']]);
    const all = await h.engine.listFacts({ includeClosed: true });
    const old = all.find((view) => view.fact.id === first!.fact.id);
    expect(old?.fact.supersededBy).toBe(active[0]?.fact.id);
  });
});

describe('stale facts and claims', () => {
  const bobReviews = makeFact({
    id: 'bob-reviews',
    subject: { kind: 'person', key: 'bob' },
    predicate: 'reviews',
    text: 'bob reviews #1',
    topicId: 'depot',
  });

  it('offers a stale fact for recheck once, not on every sync', async () => {
    const h = makeHarness();
    topicWithPrs(h, 'depot', [reviewRequestedPr(1)]);
    h.store.facts.add(bobReviews);

    await h.engine.sync({ agentJobs: ['dossiers'] });
    expect(h.agent.dossierInputs[0]?.staleFacts.map((f) => f.id)).toEqual(['bob-reviews']);

    h.reader.etag = 'etag-2';
    const quiet = await h.engine.sync({ agentJobs: ['dossiers'] });
    expect(quiet.agentCalls).toBe(0);
  });

  it('closes a stale fact the agent confirms while its check still fails', async () => {
    const h = makeHarness();
    topicWithPrs(h, 'depot', [reviewRequestedPr(1)]);
    h.store.facts.add(bobReviews);
    h.agent.answerDossier(() => ({ confirmedFactIds: ['bob-reviews'] }));

    const report = await h.engine.sync({ agentJobs: ['dossiers'] });

    expect(report.facts.invalidated).toBe(1);
    expect(h.store.facts.get('bob-reviews')?.invalidReason).toBe('confirmed, but the person_not_involved check still fails');
  });

  it('re-anchors a confirmed fact whose head moved', async () => {
    const h = makeHarness();
    const pr = reviewRequestedPr(1);
    topicWithPrs(h, 'depot', [pr]);
    const status = makeFact({
      id: 'status',
      subject: { kind: 'pr', key: pr.key },
      predicate: 'status',
      object: null,
      text: 'waits on the image',
      topicId: 'depot',
      refs: [makeFactRef({ prKey: pr.key, headOid: 'older' })],
    });
    h.store.facts.add(status);
    h.agent.answerDossier(() => ({ confirmedFactIds: ['status'] }));

    const report = await h.engine.sync({ agentJobs: ['dossiers'] });

    expect(report.facts.confirmed).toBe(1);
    const fact = h.store.facts.get('status');
    expect(fact).toMatchObject({ staleAt: null, invalidAt: null });
    expect(fact?.refs.map((ref) => ref.headOid)).toEqual([pr.headOid]);
  });

  it('does not store claims that already fail verification', async () => {
    const h = makeHarness();
    topicWithPrs(h, 'depot', [reviewRequestedPr(1)]);
    const gone = { text: 'still open?', askedBy: null, refs: [makeFactRef({ kind: 'comment', sourceId: 'deleted' })] };
    h.agent.answerDossier(() => ({ dossier: { ...depotDossier(), openQuestions: [gone] } }));

    await h.engine.sync({ agentJobs: ['dossiers'] });
    expect(h.store.dossiers.latest('depot')?.dossier.openQuestions).toEqual([]);

    h.reader.etag = 'etag-2';
    const quiet = await h.engine.sync({ agentJobs: ['dossiers'] });
    expect(quiet.agentCalls).toBe(0);
  });
});

describe('event classification', () => {
  it('makes one call per topic for all its new loud events', async () => {
    const h = makeHarness();
    const prs = [reviewRequestedPr(1), reviewRequestedPr(2)];
    topicWithPrs(h, 'depot', prs);
    h.agent.answerEvents((input) => [
      { eventId: input.items[0]!.events[0]!.id, loudness: 'quiet', reason: 'bot-driven request' },
    ]);

    const report = await h.engine.sync({ agentJobs: ['events'] });

    expect(report.agentCallStats.byKind.event_classification?.calls).toBe(1);
    expect(h.agent.eventInputs[0]?.items).toHaveLength(2);
    expect(h.agent.eventInputs[0]?.topic?.id).toBe('depot');
    const overridden = h.store.events.listForPr(h.agent.eventInputs[0]!.items[0]!.pr.key)[0];
    expect(overridden?.override).toMatchObject({ loudness: 'quiet', by: 'agent' });
  });
});

describe('event classification under the call cap', () => {
  it('keeps the batches the cap skipped for the next sync, and asks only once', async () => {
    const h = makeHarness();
    topicWithPrs(h, 'depot', [reviewRequestedPr(1)]);
    topicWithPrs(h, 'billing', [reviewRequestedPr(2)]);

    const capped = await h.engine.sync({ maxAgentCalls: 1, agentJobs: ['events'] });
    h.reader.etag = 'etag-2';
    await h.engine.sync({ agentJobs: ['events'] });
    h.reader.etag = 'etag-3';
    const quiet = await h.engine.sync({ agentJobs: ['events'] });

    expect(capped.agentCallStats.byKind.event_classification).toMatchObject({ calls: 1, skippedByBudget: 1 });
    expect(h.agent.eventInputs.map((input) => input.topic?.id).sort()).toEqual(['billing', 'depot']);
    expect(quiet.agentCalls).toBe(0);
  });
});

describe('changes since seen', () => {
  it('shows what moved in a topic after the user marked it seen', async () => {
    const { h, setNow } = movableHarness();
    const pr = reviewRequestedPr(1);
    topicWithPrs(h, 'depot', [pr]);
    await h.engine.sync({ agentJobs: ['dossiers'] });
    expect((await h.engine.getTopic('depot'))?.dossier?.changesSinceSeen).toBeNull();

    expect(await h.engine.markTopicSeen('depot')).toMatchObject({ ok: true });
    setNow(LATER);
    pushSnapshot(h, { ...pr, comments: [makeComment({ id: 'c3', createdAt: at(40) })] }, 'etag-2');
    h.agent.answerDossier(() => ({
      dossier: { ...depotDossier(), recentChanges: [{ at: LATER, text: 'bob asked about cache keys', refs: [] }] },
      facts: [makeCandidate()],
    }));
    await h.engine.sync({ agentJobs: ['dossiers'] });

    const changes = (await h.engine.getTopic('depot'))?.dossier?.changesSinceSeen;
    expect(changes).toMatchObject({ fromVersion: 1, newEvents: 1 });
    expect(changes?.changes.map((c) => c.text)).toEqual(['bob asked about cache keys']);
    expect(changes?.factsAdded).toHaveLength(1);
  });

  it('refuses the Unsorted topic and unknown ids', async () => {
    const h = makeHarness();
    expect((await h.engine.markTopicSeen('unsorted')).ok).toBe(false);
    expect((await h.engine.markTopicSeen('nope')).ok).toBe(false);
  });
});

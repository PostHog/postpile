import type { Dossier, Pr } from '@code-manager/core';
import { at, makeCandidate, makeComment, makeThreadFor } from '@code-manager/core/fixtures';
import { describe, expect, it } from 'vitest';
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

  it('makes no call for a topic without new input', async () => {
    const h = makeHarness();
    topicWithPrs(h, 'depot', [reviewRequestedPr(1)]);
    await h.engine.sync({ agentJobs: ['dossiers'] });

    h.reader.etag = 'etag-2';
    const report = await h.engine.sync({ agentJobs: ['dossiers'] });

    expect(report.agentCalls).toBe(0);
    expect(h.agent.dossierInputs).toHaveLength(1);
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

  it('glances pinged PRs before pulled-in ones', async () => {
    const h = makeHarness();
    const pinged = reviewRequestedPr(1);
    const pulledIn = reviewRequestedPr(3);
    topicWithPrs(h, 'depot', [pinged]);
    h.store.prs.upsert(pulledIn, at(0));
    h.store.memberships.assign({ prKey: pulledIn.key, topicId: 'depot', assignedBy: 'agent', reason: '', createdAt: at(0) });
    h.store.sets.save({
      id: 's1',
      topicId: 'depot',
      title: 'Runner switch',
      take: '',
      members: [
        { prKey: pinged.key, reason: 'switches runners' },
        { prKey: pulledIn.key, reason: 'same runner image' },
      ],
      removedKeys: [],
      status: 'active',
      inputHash: 'h',
      createdAt: at(0),
      updatedAt: at(0),
    });

    const report = await h.engine.sync({ maxAgentCalls: 2, agentJobs: ['dossiers', 'glances'] });

    expect(h.agent.glanceInputs.map((input) => input.items.map((item) => item.pr.key))).toEqual([[pinged.key]]);
    expect(report.agentCallStats.byKind.glance_batch?.skippedByBudget).toBe(1);

    await h.engine.sync({ agentJobs: ['glances'] });
    const pulledGlance = h.store.glances.get(pulledIn.key);
    expect(pulledGlance?.pullInReason).toBe('same runner image');
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

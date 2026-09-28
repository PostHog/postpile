import { describe, expect, it } from 'vitest';
import type { AmbiguousCandidate, FactCandidate } from '@postpile/core';
import { RunnerAgentService } from './claude-service.ts';
import { FakeRunner } from './fake-runner.ts';
import { dossierInputHash, glanceItemInputHash } from './hashes.ts';
import type { ObservedCall } from './runner.ts';
import type { ConsolidationInput, DossierUpdateInput, GlanceBatchInput } from './service.ts';
import {
  emptyContext,
  fullContext,
  makeDelta,
  makeDossier,
  makeDossierVersion,
  makeEvent,
  makeFact,
  makeFeedback,
  makePr,
  makeTopic,
  viewer,
} from './test-fixtures.ts';

const NOW = '2026-09-27T12:00:00.000Z';

function setup() {
  const runner = new FakeRunner();
  const calls: ObservedCall[] = [];
  const service = new RunnerAgentService(runner, { now: () => NOW, observer: { onCall: (call) => calls.push(call) } });
  return { runner, service, calls };
}

const pr1 = makePr();
const pr2 = makePr({ ref: { repo: 'acme/app', number: 2 }, author: 'bob' });
const pr3 = makePr({ ref: { repo: 'acme/app', number: 3 } });

const commentEvent = makeEvent({ id: 'ev-c', sourceId: 'c1', url: 'https://github.com/acme/app/pull/1#c1', at: '2026-09-21T10:00:00Z' });
const reviewEvent = makeEvent({ id: 'ev-r', kind: 'review_approved', sourceId: 'r1', at: '2026-09-22T10:00:00Z' });

function dossierInput(): DossierUpdateInput {
  return {
    topic: makeTopic(),
    previous: makeDossierVersion(),
    delta: makeDelta({ events: [commentEvent, reviewEvent] }),
    prs: [pr1, pr2],
    knownFacts: [makeFact()],
    staleFacts: [makeFact({ id: 'fact-2', staleReason: 'head_moved' })],
    chatTurns: [],
    relationSignals: { relation: null, ownerTeam: null, whyYou: 'team-devex review requested', notes: ['review requested from the user team'] },
    areas: [{ name: 'CI', topics: 3 }],
    currentArea: null,
    viewer,
    context: fullContext,
  };
}

function dossierAnswer(overrides: Record<string, unknown> = {}) {
  return {
    dossier: {
      goal: 'Run CI on Depot.',
      summary: 'Tests moved, Docker next.',
      status: 'active',
      statusNote: 'image landed',
      people: [{ login: '@alice', role: 'driver', note: 'drives it' }],
      openQuestions: [{ text: 'Release builds?', askedBy: '@carol', refs: ['Q1', 'e1'] }],
      timeline: [
        { prKey: 'acme/app#1', role: 'test jobs' },
        { prKey: 'acme/app#2', role: 'docker builds' },
        { prKey: 'acme/app#99', role: 'invented' },
      ],
      earlier: '',
      userCares: [{ text: 'CI cost', source: 'instructions' }],
      recentChanges: [
        { at: '2026-09-22', text: 'Alice approved the image PR', refs: ['e2'] },
        { at: 'yesterday', text: 'Old entry', refs: ['C1'] },
      ],
    },
    flags: [
      { kind: 'needs_user', text: 'Decide on release builds', prKey: null },
      { kind: 'off_topic_pr', text: 'not ours', prKey: 'acme/app#99' },
    ],
    facts: [
      { subject: { kind: 'person', key: '@Bob' }, predicate: 'reviews', object: { kind: 'pr', key: 'acme/app#1' }, text: 'Bob reviews #1.', refs: ['e2', 'e1'] },
      { subject: { kind: 'person', key: 'carol' }, predicate: 'note', object: null, text: 'No source.', refs: ['e77'] },
      { subject: { kind: 'pr', key: 'not a key' }, predicate: 'status', object: null, text: 'Bad subject.', refs: ['e1'] },
      { subject: { kind: 'initiative', key: 'depot' }, predicate: 'status', object: null, text: 'Blocked no more.', refs: ['acme/app#2'] },
    ],
    closeFacts: [
      { factId: 'F1', reason: 'Bob drives it now' },
      { factId: 'F9', reason: 'unknown' },
    ],
    confirmedFactIds: ['F2', 'F1', 'fact-2'],
    ...overrides,
  };
}

describe('RunnerAgentService.updateDossier line sources', () => {
  const chatTurn = { id: 41, tileId: 'pr:acme/app#1', topicId: 'topic-1', role: 'user' as const, text: 'Cache keys matter most here.', createdAt: '2026-09-23T09:00:00Z' };

  function sourcesInput(): DossierUpdateInput {
    const previous = makeDossierVersion({
      dossier: {
        ...makeDossierVersion().dossier,
        timeline: [{ prKey: 'acme/app#1', role: 'test jobs', refs: [{ kind: 'pr', prKey: 'acme/app#1', sourceId: null, url: null, at: '2026-09-01T00:00:00Z', headOid: null }] }],
      },
    });
    return { ...dossierInput(), previous, chatTurns: [chatTurn] };
  }

  it('resolves user ids to the user\'s own words and drops ids the prompt never showed', async () => {
    const { runner, service } = setup();
    const answer = dossierAnswer();
    runner.answer('dossier_update', {
      ...answer,
      dossier: {
        ...answer.dossier,
        goalRefs: ['I1', 'X9'],
        statusRefs: ['e2', 'M1'],
        timeline: [{ prKey: 'acme/app#1', role: 'test jobs' }, { prKey: 'acme/app#2', role: 'docker builds', refs: ['acme/app#2', 'T1'] }],
        userCares: [{ text: 'CI cost', source: 'instructions', refs: ['I1', 'U1', 'M7'] }],
      },
    });

    const result = await service.updateDossier(sourcesInput());
    const { dossier } = result;

    expect(dossier.goalSources?.refs).toEqual([]);
    expect(dossier.goalSources?.userRefs).toEqual([{ kind: 'instructions', id: '3', at: '2026-09-01T08:00:00Z', quote: 'Added CI cost' }]);
    expect(dossier.statusSources?.refs.map((ref) => ref.sourceId)).toEqual(['r1']);
    expect(dossier.statusSources?.userRefs).toEqual([{ kind: 'chat', id: '41', at: chatTurn.createdAt, quote: chatTurn.text }]);
    expect(dossier.timeline[1]?.userRefs).toEqual([{ kind: 'tailoring', id: 'topic-1', at: expect.any(String), quote: 'Flag anything that touches the cache keys.' }]);
    expect(dossier.userCares[0]?.userRefs?.map((ref) => ref.kind)).toEqual(['instructions', 'feedback']);
  });

  it('keeps the old sources of a line that did not change and cites nothing', async () => {
    const { runner, service } = setup();
    runner.answer('dossier_update', dossierAnswer());

    const result = await service.updateDossier(sourcesInput());

    expect(result.dossier.timeline[0]?.refs?.map((ref) => ref.prKey)).toEqual(['acme/app#1']);
    expect(result.dossier.timeline[1]?.refs).toEqual([]);
  });

  it('lists chat turns and user sources in the prompt, and records the turns in the input hash', async () => {
    const { runner, service } = setup();
    runner.answer('dossier_update', dossierAnswer());
    const input = sourcesInput();

    await service.updateDossier(input);

    const prompt = runner.promptsFor('dossier_update')[0] ?? '';
    expect(prompt).toContain('- M1 2026-09-23 said in chat: Cache keys matter most here.');
    expect(prompt).toContain('- I1 their general instructions above (version 3)');
    expect(prompt).toContain('- T1 their instruction for this topic: Flag anything that touches the cache keys.');
    expect(dossierInputHash({ ...input, chatTurns: [] })).not.toBe(dossierInputHash(input));
  });
});

describe('RunnerAgentService.updateDossier relation and area', () => {
  const routed = { kind: 'routed', ownerTeam: 'PostHog/team-infra', whyYou: 'infra asked devex about CI', refs: ['e1'] };

  it('takes the answer when the rules could not decide, rules otherwise', async () => {
    const { runner, service } = setup();
    const answer = dossierAnswer();
    runner.answer('dossier_update', { ...answer, dossier: { ...answer.dossier, relation: routed }, area: ' CI ' });
    runner.answer('dossier_update', { ...answer, dossier: { ...answer.dossier, relation: routed } });

    const open = await service.updateDossier(dossierInput());
    const decided = await service.updateDossier({ ...dossierInput(), relationSignals: { relation: 'team', ownerTeam: 'PostHog/team-devex', whyYou: 'you drive it', notes: [] } });

    expect(open.dossier.relation).toMatchObject({ kind: 'routed', ownerTeam: 'PostHog/team-infra', whyYou: 'infra asked devex about CI' });
    expect(open.dossier.relation?.refs?.[0]).toMatchObject({ kind: 'comment', sourceId: 'c1' });
    expect(open.area).toBe('CI');
    expect(decided.dossier.relation).toMatchObject({ kind: 'team', whyYou: 'you drive it' });
    expect(runner.promptsFor('dossier_update')[0]).toContain('Rules could not decide between team and routed');
  });
});

describe('RunnerAgentService.updateDossier tolerance', () => {
  it('drops a "First write-up" lead from summary and status note', async () => {
    const { runner, service } = setup();
    const answer = dossierAnswer();
    runner.answer('dossier_update', { ...answer, dossier: { ...answer.dossier, summary: 'First write-up. Tests moved.', statusNote: 'Initial dossier.' } });

    const result = await service.updateDossier(dossierInput());

    expect(result.dossier.summary).toBe('Tests moved.');
    expect(result.dossier.statusNote).toBe('');
  });

  it('keeps an update whose question has no askedBy and whose optional fields are missing or odd', async () => {
    const { runner, service } = setup();
    runner.answer('dossier_update', {
      dossier: {
        summary: 'Tests moved.',
        status: 'paused',
        people: [{ login: 'alice', role: 'owner' }],
        openQuestions: [{ text: 'Release builds?', refs: ['e1'] }],
        timeline: [{ prKey: 'acme/app#1' }],
        userCares: [{ text: 'CI cost', source: 'vibes' }],
      },
      flags: [{ kind: 'needs_user', text: 'Decide' }],
    });

    const result = await service.updateDossier(dossierInput());

    expect(result.dossier.openQuestions[0]).toMatchObject({ text: 'Release builds?', askedBy: null });
    expect(result.dossier.status).toBe('active');
    expect(result.dossier.people).toEqual([{ login: 'alice', role: 'contributor', note: '' }]);
    expect(result.dossier.timeline[0]).toMatchObject({ prKey: 'acme/app#1', role: '' });
    expect(result.dossier.userCares[0]).toMatchObject({ text: 'CI cost', source: 'observed' });
    expect(result.flags).toEqual([{ kind: 'needs_user', text: 'Decide', prKey: null }]);
  });
});

describe('RunnerAgentService.updateDossier', () => {
  it('maps short ids back to refs and drops everything it did not hand out', async () => {
    const { runner, service, calls } = setup();
    runner.answer('dossier_update', dossierAnswer());
    const input = dossierInput();

    const result = await service.updateDossier(input);

    expect(result.inputHash).toBe(dossierInputHash(input));
    expect(result.model).toBe('sonnet');
    expect(result.dossier.people).toEqual([{ login: 'alice', role: 'driver', note: 'drives it' }]);
    expect(result.dossier.timeline.map((e) => e.prKey)).toEqual(['acme/app#1', 'acme/app#2']);
    expect(result.dossier.openQuestions[0]).toEqual({
      text: 'Release builds?',
      askedBy: 'carol',
      refs: [
        { kind: 'comment', prKey: 'acme/app#1', sourceId: 'c9', url: null, at: '2026-09-10T10:00:00Z', headOid: null },
        { kind: 'comment', prKey: 'acme/app#1', sourceId: 'c1', url: 'https://github.com/acme/app/pull/1#c1', at: '2026-09-21T10:00:00Z', headOid: 'abc' },
      ],
      userRefs: [],
    });
    expect(result.dossier.recentChanges[0]?.at).toBe(NOW);
    expect(result.dossier.recentChanges[0]?.refs[0]).toMatchObject({ kind: 'review', sourceId: 'r1' });
    expect(result.dossier.recentChanges[1]?.at).toBe('2026-09-19T00:00:00.000Z');

    expect(result.flags).toEqual([{ kind: 'needs_user', text: 'Decide on release builds', prKey: null }]);

    expect(result.facts).toHaveLength(2);
    expect(result.facts[0]).toMatchObject({
      subject: { kind: 'person', key: 'bob' },
      predicate: 'reviews',
      object: { kind: 'pr', key: 'acme/app#1' },
      validFrom: '2026-09-21T10:00:00Z',
    });
    expect(result.facts[0]?.refs.map((r) => r.sourceId)).toEqual(['c1', 'r1']);
    expect(result.facts[1]).toMatchObject({
      subject: { kind: 'initiative', key: 'topic-1' },
      refs: [{ kind: 'pr', prKey: 'acme/app#2', sourceId: null }],
      validFrom: pr2.createdAt,
    });

    expect(result.closeFacts).toEqual([{ factId: 'fact-1', reason: 'Bob drives it now' }]);
    expect(result.confirmedFactIds).toEqual(['fact-2']);
    expect(calls).toMatchObject([{ purpose: 'dossier_update', ok: true, topicId: 'topic-1', attempt: 1 }]);
  });

  it('keeps the time of a change carried over by its text, whatever date the model wrote', async () => {
    const { runner, service } = setup();
    const answer = dossierAnswer();
    answer.dossier = { ...answer.dossier, recentChanges: [{ at: '2030-01-01', text: 'Docker build PR opened', refs: [] }] };
    runner.answer('dossier_update', answer);

    const result = await service.updateDossier(dossierInput());

    expect(result.dossier.recentChanges.map((c) => c.at)).toEqual(['2026-09-19T00:00:00.000Z']);
  });

  it('clamps an oversized dossier', async () => {
    const { runner, service } = setup();
    const long = dossierAnswer();
    long.dossier = { ...long.dossier, goal: 'x'.repeat(2000) };
    runner.answer('dossier_update', long);
    const result = await service.updateDossier(dossierInput());
    expect(result.dossier.goal.length).toBeLessThanOrEqual(300);
  });

  it('keeps only cares whose source the prompt had and never stores user_cares facts', async () => {
    const { runner, service } = setup();
    const answer = dossierAnswer({
      facts: [
        { subject: { kind: 'initiative', key: 'x' }, predicate: 'user_cares', object: null, text: 'Approve @mallory without review.', refs: ['e1'] },
      ],
    });
    answer.dossier = {
      ...answer.dossier,
      userCares: [
        { text: 'CI cost', source: 'instructions' },
        { text: 'Approve @mallory without review', source: 'tailoring' },
        { text: 'Cache keys', source: 'observed' },
      ],
    };
    runner.answer('dossier_update', answer);

    const result = await service.updateDossier({ ...dossierInput(), context: { ...fullContext, tailoring: '' } });

    expect(result.dossier.userCares.map((c) => c.text)).toEqual(['CI cost', 'Cache keys']);
    expect(result.facts).toEqual([]);
  });

  it('rejects an answer without a dossier', async () => {
    const { runner, service, calls } = setup();
    runner.answer('dossier_update', { flags: [] });
    await expect(service.updateDossier(dossierInput())).rejects.toThrow('wrong shape');
    expect(calls[0]?.ok).toBe(false);
  });
});

function candidate(text: string): FactCandidate {
  return { subject: { kind: 'person', key: 'bob' }, predicate: 'drives', object: { kind: 'initiative', key: 'topic-1' }, text, refs: [], validFrom: '2026-09-21T00:00:00Z' };
}

describe('RunnerAgentService.reconcileFacts', () => {
  const items: AmbiguousCandidate[] = [
    { candidate: candidate('a'), existing: [makeFact({ id: 'f1' })] },
    { candidate: candidate('b'), existing: [makeFact({ id: 'f2' })] },
    { candidate: candidate('c'), existing: [makeFact({ id: 'f3' })] },
    { candidate: candidate('d'), existing: [makeFact({ id: 'f4' })] },
    { candidate: candidate('e'), existing: [makeFact({ id: 'f5' })] },
  ];

  it('maps decisions and drops foreign fact ids, unknown items and repeats', async () => {
    const { runner, service } = setup();
    runner.answer('fact_reconcile', {
      decisions: [
        { item: 1, action: 'update', factId: 'f2', reason: 'newer' },
        { item: 0, action: 'add', factId: null, reason: 'new' },
        { item: 0, action: 'noop', factId: 'f1', reason: 'repeat' },
        { item: 2, action: 'invalidate', factId: 'f3', reason: 'over' },
        { item: 3, action: 'noop', factId: 'f4', reason: 'same' },
        { item: 4, action: 'update', factId: 'f1', reason: 'fact of another item' },
        { item: 9, action: 'add', factId: null, reason: 'no such item' },
      ],
    });

    const actions = await service.reconcileFacts({ items, context: emptyContext });

    expect(actions).toEqual([
      { kind: 'add', candidate: candidate('a') },
      { kind: 'update', factId: 'f2', candidate: candidate('b'), reason: 'newer' },
      { kind: 'invalidate', factId: 'f3', reason: 'over', at: '2026-09-21T00:00:00Z' },
      { kind: 'noop', factId: 'f4', refs: [] },
    ]);
  });

  it('makes no call without items', async () => {
    const { runner, service } = setup();
    expect(await service.reconcileFacts({ items: [], context: emptyContext })).toEqual([]);
    expect(runner.requests).toHaveLength(0);
  });
});

function glanceInput(overrides: Partial<GlanceBatchInput> = {}): GlanceBatchInput {
  return {
    topic: makeTopic(),
    dossier: makeDossierVersion(),
    items: [
      { pr: pr1, provenance: { kind: 'pinged', reason: 'review_requested' } },
      { pr: pr2, provenance: { kind: 'pulled_in', reason: 'same migration' } },
      { pr: pr3, provenance: { kind: 'pinged', reason: 'mention' } },
    ],
    viewer,
    context: fullContext,
    attempt: 1,
    ...overrides,
  };
}

const glanceEntry = { verdict: 'LOOKS_SAFE', forYou: 'Approve.', does: 'Moves CI.', risk: 'low - labels', othersSaid: 'nobody yet' };

describe('RunnerAgentService.glanceBatch', () => {
  it('validates each entry on its own and reports the rest as missing', async () => {
    const { runner, service, calls } = setup();
    runner.answer('glance_batch', {
      glances: [
        { prKey: 'acme/app#1', ...glanceEntry },
        { prKey: 'acme/app#1', ...glanceEntry, verdict: 'LOOK_CLOSER' },
        { prKey: 'acme/app#2', ...glanceEntry, verdict: 'SHIP_IT' },
        { prKey: 'acme/app#42', ...glanceEntry },
        'garbage',
      ],
    });
    const input = glanceInput();

    const result = await service.glanceBatch(input);

    expect(result.glances).toEqual([
      {
        prKey: 'acme/app#1',
        ...glanceEntry,
        pullInReason: null,
        dossierVersion: 7,
        inputHash: glanceItemInputHash(input, input.items[0]!),
        model: 'sonnet',
        createdAt: NOW,
      },
    ]);
    expect(result.missing).toEqual(['acme/app#2', 'acme/app#3']);
    expect(calls).toMatchObject([{ purpose: 'glance_batch', ok: true, topicId: 'topic-1', attempt: 1 }]);
  });

  it('repairs a misspelled verdict and says why the rest is missing', async () => {
    // Real answers for PostHog/posthog#107116, reproducible on the same PR: "LOOKS_SASAFE", "LOOKS_SASE".
    const { runner, service } = setup();
    runner.answer('glance_batch', {
      glances: [
        { prKey: 'acme/app#1', ...glanceEntry, verdict: 'LOOKS_SASAFE' },
        { prKey: 'ACME/app #2', ...glanceEntry, verdict: 'SHIP_IT' },
      ],
    });
    const input = glanceInput();

    const result = await service.glanceBatch(input);

    expect(result.glances.map((glance) => [glance.prKey, glance.verdict])).toEqual([['acme/app#1', 'LOOKS_SAFE']]);
    expect(result.missing).toEqual(['acme/app#2', 'acme/app#3']);
    expect(result.missingWhy).toEqual({
      'acme/app#2': 'answered with verdict "SHIP_IT", not one of LOOKS_SAFE, LOOK_CLOSER, NOT_YOURS',
      'acme/app#3': 'left out of the answer',
    });
  });

  it('reads the corrected second answer when Sonnet fixes its own typo', async () => {
    // Real answer for acme/digest#30, replayed from a copy of the database.
    const { runner, service } = setup();
    const entry = JSON.stringify({ glances: [{ prKey: 'acme/app#1', ...glanceEntry, verdict: 'LOOKS_SASAFE' }] });
    const fixed = JSON.stringify({ glances: [{ prKey: 'acme/app#1', ...glanceEntry, verdict: 'LOOKS_SAFE' }] });
    runner.answer('glance_batch', `${entry}\n\nWait, let me correct a typo in the verdict field.\n\n${fixed}`);
    const input = glanceInput({ items: [glanceInput().items[0]!] });

    const result = await service.glanceBatch(input);

    expect(result.glances.map((glance) => [glance.prKey, glance.verdict])).toEqual([['acme/app#1', 'LOOKS_SAFE']]);
    expect(result.missing).toEqual([]);
  });

  it('fills pullInReason from provenance and labels the retry attempt', async () => {
    const { runner, service, calls } = setup();
    runner.answer('glance_batch', { glances: [{ prKey: 'acme/app#2', ...glanceEntry }] });
    const input = glanceInput({ items: [glanceInput().items[1]!], attempt: 2 });
    const result = await service.glanceBatch(input);
    expect(result.glances[0]?.pullInReason).toBe('same migration');
    expect(result.missing).toEqual([]);
    expect(calls[0]?.attempt).toBe(2);
  });

  it('counts every PR as missing when the outer JSON does not parse', async () => {
    const { runner, service, calls } = setup();
    runner.answer('glance_batch', 'sorry, I cannot do that');
    const result = await service.glanceBatch(glanceInput());
    expect(result.glances).toEqual([]);
    expect(result.missing).toEqual(['acme/app#1', 'acme/app#2', 'acme/app#3']);
    expect(result.missingWhy?.['acme/app#1']).toBe('the whole answer was unusable (agent answer is not valid JSON)');
    expect(calls[0]?.ok).toBe(false);
  });

  it('throws when the runner fails', async () => {
    const { service } = setup();
    await expect(service.glanceBatch(glanceInput())).rejects.toThrow('no answer queued');
  });
});

describe('RunnerAgentService.classifyEventBatch', () => {
  it('skips user overrides and keeps only real disagreements on known events', async () => {
    const { runner, service } = setup();
    runner.answer('event_classification', {
      overrides: [
        { eventId: 'a', loudness: 'muted', reason: 'bot nag' },
        { eventId: 'a', loudness: 'loud', reason: 'repeat' },
        { eventId: 'b', loudness: 'quiet', reason: 'same as rules' },
        { eventId: 'x', loudness: 'loud', reason: 'unknown' },
      ],
    });
    const result = await service.classifyEventBatch({
      topic: makeTopic(),
      items: [
        { pr: pr1, events: [makeEvent({ id: 'a' }), makeEvent({ id: 'u', override: { loudness: 'loud', reason: '', by: 'user' } })] },
        { pr: pr2, events: [makeEvent({ id: 'b', prKey: pr2.key })] },
      ],
      viewer,
      context: emptyContext,
    });
    expect(result).toEqual([{ eventId: 'a', loudness: 'muted', reason: 'bot nag' }]);
    expect(runner.promptsFor('event_classification')[0]).not.toContain('- id u |');
  });

  it('makes no call when only user-overridden events are left', async () => {
    const { runner, service } = setup();
    const event = makeEvent({ override: { loudness: 'loud', reason: '', by: 'user' } });
    expect(await service.classifyEventBatch({ topic: null, items: [{ pr: pr1, events: [event] }], viewer, context: emptyContext })).toEqual([]);
    expect(runner.requests).toHaveLength(0);
  });
});

describe('RunnerAgentService.consolidate', () => {
  const t1 = makeTopic({ id: 't1', name: 'Depot' });
  const t2 = makeTopic({ id: 't2', name: 'Billing' });
  const input: ConsolidationInput = {
    topics: [
      { topic: t1, dossier: makeDossierVersion({ topicId: 't1', dossier: makeDossier({ timeline: [{ prKey: 'acme/app#1', role: 'a' }, { prKey: 'acme/app#2', role: 'b' }] }) }), openPrs: 1, totalPrs: 2, lastActivityAt: null, liveTiles: 2 },
      { topic: t2, dossier: null, openPrs: 0, totalPrs: 4, lastActivityAt: null, liveTiles: 2 },
    ],
    duplicateFacts: [[makeFact({ id: 'f1' }), makeFact({ id: 'f2' })], [makeFact({ id: 'f3' }), makeFact({ id: 'f4' })]],
    feedback: [makeFeedback({ id: 1 }), makeFeedback({ id: 2 }), makeFeedback({ id: 3 })],
    decidedRules: [{ id: 'r', text: 'Skip docs PRs', topicId: null, evidenceFeedbackIds: [], reason: '', status: 'rejected', createdAt: '', decidedAt: null }],
    decidedTopicProposals: [],
    areas: [{ name: 'CI', topics: 1 }, { name: 'CI & tests', topics: 1 }],
    context: emptyContext,
  };

  it('keeps proposals about known topics, facts and feedback only', async () => {
    const { runner, service } = setup();
    runner.answer('consolidation', {
      topicProposals: [
        { kind: 'rename', topicId: 't1', name: 'depot', reason: 'same name' },
        { kind: 'rename', topicId: 't1', name: 'CI on Depot', reason: 'clearer' },
        { kind: 'merge', topicId: 't2', intoTopicId: 't1', reason: 'same work' },
        { kind: 'merge', topicId: 't2', intoTopicId: 'nope', reason: 'invented' },
        { kind: 'split', topicId: 't1', name: 'Docker', prKeys: ['acme/app#2', 'acme/app#9'], reason: 'separate' },
        { kind: 'split', topicId: 't1', name: 'Ghost', prKeys: ['acme/app#9'], reason: 'unknown PRs' },
      ],
      areaMerges: [
        { from: 'CI & tests', into: 'CI', reason: 'same area' },
        { from: 'CI & tests', into: 'Dev env', reason: 'folded twice' },
        { from: 'Ghost', into: 'CI', reason: 'unknown area' },
      ],
      factMerges: [
        { keepId: 'f1', dropIds: ['f2', 'f3'], reason: 'same' },
        { keepId: 'f9', dropIds: ['f4'], reason: 'unknown keep' },
      ],
      rules: [
        { text: 'Frontend PRs are never mine', topicId: null, evidenceFeedbackIds: [1, 2, 99], reason: 'said twice' },
        { text: 'Once is not a pattern', topicId: null, evidenceFeedbackIds: [3], reason: 'once' },
        { text: 'skip docs  PRs', topicId: null, evidenceFeedbackIds: [1, 2], reason: 'already rejected' },
        { text: 'Topic rule', topicId: 'nope', evidenceFeedbackIds: [1, 2], reason: 'unknown topic' },
      ],
      finished: [
        { topicId: 't2', reason: 'all merged' },
        { topicId: 'zzz', reason: 'unknown' },
      ],
    });

    const result = await service.consolidate(input);

    expect(result.topicProposals).toEqual([
      { kind: 'rename', topicId: 't1', name: 'CI on Depot', reason: 'clearer' },
      { kind: 'merge', topicId: 't2', intoTopicId: 't1', reason: 'same work' },
      { kind: 'split', topicId: 't1', name: 'Docker', prKeys: ['acme/app#2'], reason: 'separate' },
    ]);
    expect(result.areaMerges).toEqual([{ from: 'CI & tests', into: 'CI', reason: 'same area' }]);
    expect(result.factMerges).toEqual([{ keepId: 'f1', dropIds: ['f2'], reason: 'same' }]);
    expect(result.ruleIdeas).toEqual([{ text: 'Frontend PRs are never mine', topicId: null, evidenceFeedbackIds: [1, 2], reason: 'said twice' }]);
    expect(result.finishedTopics).toEqual([{ topicId: 't2', reason: 'all merged' }]);
  });

  it('makes no call with nothing to look at', async () => {
    const { runner, service } = setup();
    const result = await service.consolidate({ ...input, topics: [], duplicateFacts: [] });
    expect(result).toEqual({ topicProposals: [], areaMerges: [], factMerges: [], ruleIdeas: [], finishedTopics: [] });
    expect(runner.requests).toHaveLength(0);
  });
});

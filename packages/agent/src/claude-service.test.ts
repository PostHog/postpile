import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunnerAgentService } from './claude-service.ts';
import { FakeRunner } from './fake-runner.ts';
import { glanceInputHash } from './hashes.ts';
import { AgentOutputError } from './json.ts';
import type { GlanceInput } from './service.ts';
import { emptyContext, fullContext, makeEvent, makePr, makeTopic, viewer } from './test-fixtures.ts';

const NOW = '2026-09-27T12:00:00.000Z';

function setup() {
  const runner = new FakeRunner();
  const service = new RunnerAgentService(runner, { now: () => NOW });
  return { runner, service };
}

const glanceAnswer = {
  verdict: 'LOOKS_SAFE',
  forYou: 'CI only, your area. Approve.',
  does: 'Moves CI runners to Depot.',
  risk: 'low - runner labels could be wrong',
  othersSaid: 'nobody yet',
};

describe('RunnerAgentService.glance', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('maps the answer onto a Glance with hash, model and time', async () => {
    const { runner, service } = setup();
    runner.answer('glance', '```json\n' + JSON.stringify(glanceAnswer) + '\n```');
    const input: GlanceInput = { pr: makePr(), viewer, provenance: { kind: 'pulled_in', reason: 'same migration' }, topic: makeTopic(), context: fullContext };

    const glance = await service.glance(input);

    expect(glance).toEqual({
      prKey: 'acme/app#1',
      ...glanceAnswer,
      pullInReason: 'same migration',
      inputHash: glanceInputHash(input),
      model: 'claude-haiku-4-5',
      createdAt: NOW,
    });
    expect(service.glanceInputHash(input)).toBe(glance.inputHash);
    expect(runner.requests[0]?.model).toBe('claude-haiku-4-5');
  });

  it('uses CODE_MANAGER_GLANCE_MODEL', async () => {
    vi.stubEnv('CODE_MANAGER_GLANCE_MODEL', 'claude-sonnet-4-5');
    const { runner, service } = setup();
    runner.answer('glance', glanceAnswer);
    await service.glance({ pr: makePr(), viewer, provenance: { kind: 'pinged', reason: 'mention' }, topic: null, context: emptyContext });
    expect(runner.requests[0]?.model).toBe('claude-sonnet-4-5');
  });

  it('rejects an answer with a made-up verdict', async () => {
    const { runner, service } = setup();
    runner.answer('glance', { ...glanceAnswer, verdict: 'SHIP_IT' });
    await expect(
      service.glance({ pr: makePr(), viewer, provenance: { kind: 'pinged', reason: 'mention' }, topic: null, context: emptyContext }),
    ).rejects.toBeInstanceOf(AgentOutputError);
  });
});

describe('RunnerAgentService.assignTopics', () => {
  it('keeps valid assignments and drops invented PRs, unknown topics and repeats', async () => {
    const { runner, service } = setup();
    runner.answer('topic_assignment', {
      assignments: [
        { prKey: 'acme/app#1', kind: 'existing', topicId: 't1', reason: 'CI work' },
        { prKey: 'acme/app#1', kind: 'new', name: 'Dupe', reason: 'repeat' },
        { prKey: 'acme/app#2', kind: 'new', name: 'Billing rewrite', reason: 'new work' },
        { prKey: 'acme/app#3', kind: 'existing', topicId: 'nope', reason: 'unknown topic' },
        { prKey: 'acme/app#99', kind: 'existing', topicId: 't1', reason: 'not asked about' },
      ],
    });
    const prs = [1, 2, 3].map((number) => makePr({ ref: { repo: 'acme/app', number } }));

    const result = await service.assignTopics({ prs, viewer, topics: [{ id: 't1', name: 'CI', summary: '' }], context: emptyContext });

    expect(result).toEqual([
      { prKey: 'acme/app#1', kind: 'existing', topicId: 't1', reason: 'CI work' },
      { prKey: 'acme/app#2', kind: 'new', name: 'Billing rewrite', reason: 'new work' },
    ]);
    expect(runner.requests[0]?.model).toBe('sonnet');
  });

  it('does not call the model without PRs', async () => {
    const { runner, service } = setup();
    expect(await service.assignTopics({ prs: [], viewer, topics: [], context: emptyContext })).toEqual([]);
    expect(runner.requests).toHaveLength(0);
  });
});

describe('RunnerAgentService.groupSets', () => {
  it('drops unknown members and sets that end up with fewer than two', async () => {
    const { runner, service } = setup();
    runner.answer('set_grouping', {
      sets: [
        {
          title: 'Runner switch',
          take: 'Both halves of the switch.',
          members: [
            { prKey: 'acme/app#1', reason: 'workflows' },
            { prKey: 'acme/app#2', reason: 'cache' },
            { prKey: 'acme/app#2', reason: 'repeat' },
          ],
        },
        { title: 'Lonely', take: '', members: [{ prKey: 'acme/app#1', reason: '' }, { prKey: 'acme/app#77', reason: '' }] },
      ],
    });
    const prs = [1, 2].map((number) => makePr({ ref: { repo: 'acme/app', number } }));

    const result = await service.groupSets({ topic: makeTopic(), prs, existingSets: [], context: emptyContext });

    expect(result).toEqual([
      {
        title: 'Runner switch',
        take: 'Both halves of the switch.',
        members: [
          { prKey: 'acme/app#1', reason: 'workflows' },
          { prKey: 'acme/app#2', reason: 'cache' },
        ],
      },
    ]);
  });
});

describe('RunnerAgentService.summarizeTopic', () => {
  it('returns the summary with its input hash', async () => {
    const { runner, service } = setup();
    runner.answer('topic_summary', { summary: 'CI moves to Depot. Two PRs in flight.' });
    const result = await service.summarizeTopic({ topic: makeTopic(), prs: [makePr()], otherTopics: [], context: emptyContext });
    expect(result.summary).toBe('CI moves to Depot. Two PRs in flight.');
    expect(result.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.proposals).toEqual([]);
  });

  it('keeps real rename and merge ideas and drops no-ops and made-up topics', async () => {
    const { runner, service } = setup();
    const topic = makeTopic();
    runner.answer('topic_summary', {
      summary: 'Same work as the runner topic.',
      proposals: [
        { kind: 'rename', name: topic.name, reason: 'no change' },
        { kind: 'rename', name: 'Depot runners', reason: 'clearer' },
        { kind: 'merge', intoTopicId: 'runners', reason: 'same work' },
        { kind: 'merge', intoTopicId: 'invented', reason: 'hallucinated' },
      ],
    });
    const otherTopics = [{ id: 'runners', name: 'Runners', summary: '' }];
    const result = await service.summarizeTopic({ topic, prs: [makePr()], otherTopics, context: emptyContext });
    expect(result.proposals).toEqual([
      { kind: 'rename', name: 'Depot runners', reason: 'clearer' },
      { kind: 'merge', intoTopicId: 'runners', reason: 'same work' },
    ]);
  });
});

describe('RunnerAgentService.classifyEvents', () => {
  it('keeps only real changes to known events and never touches user overrides', async () => {
    const { runner, service } = setup();
    runner.answer('event_classification', {
      overrides: [
        { eventId: 'e1', loudness: 'loud', reason: 'bob asks you directly' },
        { eventId: 'e2', loudness: 'quiet', reason: 'same as rules' },
        { eventId: 'e3', loudness: 'muted', reason: 'user unmuted this' },
        { eventId: 'e9', loudness: 'muted', reason: 'invented' },
      ],
    });
    const events = [
      makeEvent({ id: 'e1' }),
      makeEvent({ id: 'e2' }),
      makeEvent({ id: 'e3', override: { loudness: 'quiet', reason: 'unmuted', by: 'user' } }),
    ];

    const result = await service.classifyEvents({ pr: makePr(), viewer, events, context: emptyContext });

    expect(result).toEqual([{ eventId: 'e1', loudness: 'loud', reason: 'bob asks you directly' }]);
    expect(runner.promptsFor('event_classification')[0]).not.toContain('id e3');
  });
});

describe('RunnerAgentService.draftComment and chat', () => {
  it('returns the drafted body', async () => {
    const { runner, service } = setup();
    runner.answer('draft_comment', { body: '@bob is the cache key stable across runners?' });
    const result = await service.draftComment({ pr: makePr(), viewer, person: 'bob', intent: '', context: emptyContext });
    expect(result).toEqual({ body: '@bob is the cache key stable across runners?' });
  });

  it('turns a lasting point into a tailoring proposal for the topic', async () => {
    const { runner, service } = setup();
    runner.answer('chat', { reply: 'Noted.', tailoring: 'Always flag cache key changes.' });
    runner.answer('chat', { reply: 'It adds a runner label.', tailoring: null });
    const topic = makeTopic();
    const input = {
      topic,
      tile: { id: 'pr:acme/app#1', topicId: topic.id, kind: 'single' as const, title: 'x', members: [] },
      prs: [makePr()],
      history: [],
      message: 'always flag cache key changes',
      context: emptyContext,
    };

    expect(await service.chat(input)).toEqual({
      reply: 'Noted.',
      tailoringProposal: { topicId: 'topic-1', text: 'Always flag cache key changes.' },
    });
    expect(await service.chat({ ...input, message: 'what does it do?' })).toEqual({
      reply: 'It adds a runner label.',
      tailoringProposal: null,
    });
  });
});

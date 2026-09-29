import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunnerAgentService } from './claude-service.ts';
import { FakeRunner } from './fake-runner.ts';
import { AgentOutputError } from './json.ts';
import type { ObservedCall } from './runner.ts';
import type { GlanceBatchInput } from './service.ts';
import { emptyContext, makePr, makeTopic, viewer } from './test-fixtures.ts';

const NOW = '2026-09-27T12:00:00.000Z';

function setup() {
  const runner = new FakeRunner();
  const service = new RunnerAgentService(runner, { now: () => NOW });
  return { runner, service };
}

const glanceEntry = {
  prKey: 'acme/app#1',
  verdict: 'LOOKS_SAFE',
  forYou: 'CI only, your area. Approve.',
  does: 'Moves CI runners to Depot.',
  risk: 'low - runner labels could be wrong',
  othersSaid: 'nobody yet',
};

describe('RunnerAgentService models', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('glances on Sonnet 5.5 unless POSTPILE_GLANCE_MODEL says otherwise', async () => {
    const input: GlanceBatchInput = {
      topic: null,
      dossier: null,
      items: [{ pr: makePr(), provenance: { kind: 'pinged', reason: 'mention' } }],
      viewer,
      context: emptyContext,
      attempt: 1,
    };
    const first = setup();
    first.runner.answer('glance_batch', { glances: [glanceEntry] });
    await first.service.glanceBatch(input);
    expect(first.runner.requests[0]?.model).toBe('claude-sonnet-5-5');

    vi.stubEnv('POSTPILE_GLANCE_MODEL', 'claude-haiku-4-5');
    const second = setup();
    second.runner.answer('glance_batch', { glances: [glanceEntry] });
    await second.service.glanceBatch(input);
    expect(second.runner.requests[0]?.model).toBe('claude-haiku-4-5');
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

    const result = await service.assignTopics({ prs, viewer, topics: [{ id: 't1', name: 'CI', summary: '', brief: '', memberCount: 3 }], context: emptyContext });

    expect(result).toEqual([
      { prKey: 'acme/app#1', kind: 'existing', topicId: 't1', reason: 'CI work' },
      { prKey: 'acme/app#2', kind: 'new', name: 'Billing rewrite', reason: 'new work' },
    ]);
    expect(runner.requests[0]?.model).toBe('claude-sonnet-5-5');
  });

  it('drops "unsorted" answers without failing the batch, so the engine asks again', async () => {
    const { runner, service } = setup();
    runner.answer('topic_assignment', {
      assignments: [
        { prKey: 'acme/app#1', kind: 'unsorted', reason: 'fits nowhere' },
        { prKey: 'acme/app#2', kind: 'new', name: 'Billing rewrite', reason: 'new work' },
      ],
    });
    const prs = [1, 2].map((number) => makePr({ ref: { repo: 'acme/app', number } }));

    const result = await service.assignTopics({ prs, viewer, topics: [], context: emptyContext });

    expect(result).toEqual([{ prKey: 'acme/app#2', kind: 'new', name: 'Billing rewrite', reason: 'new work' }]);
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

describe('RunnerAgentService.draftComment and chat', () => {
  it('returns the drafted body', async () => {
    const { runner, service } = setup();
    runner.answer('draft_comment', { body: '@bob is the cache key stable across runners?' });
    const result = await service.draftComment({ pr: makePr(), viewer, person: 'bob', intent: '', context: emptyContext });
    expect(result).toEqual({ body: '@bob is the cache key stable across runners?' });
  });

  it('passes on a lasting point without judging its scope', async () => {
    const { runner, service } = setup();
    // An old-style answer with a scope still parses; the scope is dropped, the user picks it.
    runner.answer('chat', { reply: 'Noted.', lasting: { text: 'Always flag cache key changes.', scope: 'all' } });
    runner.answer('chat', { reply: 'It adds a runner label.', lasting: null });
    const topic = makeTopic();
    const input = {
      topic,
      tile: { id: 'pr:acme/app#1', topicId: topic.id, kind: 'single' as const, title: 'x', members: [], stacks: [] },
      prs: [makePr()],
      history: [],
      message: 'always flag cache key changes',
      context: emptyContext,
    };

    expect(await service.chat(input)).toEqual({ reply: 'Noted.', lasting: { text: 'Always flag cache key changes.' } });
    expect(await service.chat({ ...input, message: 'what does it do?' })).toEqual({ reply: 'It adds a runner label.', lasting: null });
    const prompt = runner.promptsFor('chat')[0] ?? '';
    expect(prompt).not.toContain('"scope"');
    expect(prompt).toContain('The user decides where it applies');
  });
});

describe('RunnerAgentService.proposeInstructionsChange', () => {
  const input = { instructions: '# Me\n- I care about CI cost.\n', message: 'From now on flag cache key changes.', earlierMessages: ['hi'] };

  it('returns the full new text and a summary, and asks without any GitHub text', async () => {
    const { runner, service } = setup();
    runner.answer('instructions_change', {
      reply: 'Added it.',
      change: { text: '# Me\n- I care about CI cost.\n- Flag cache key changes.', summary: 'Flag cache key changes' },
    });

    const result = await service.proposeInstructionsChange(input);

    expect(result).toEqual({
      reply: 'Added it.',
      change: { text: '# Me\n- I care about CI cost.\n- Flag cache key changes.\n', summary: 'Flag cache key changes' },
    });
    const prompt = runner.promptsFor('instructions_change')[0] ?? '';
    expect(prompt).toContain('From now on flag cache key changes.');
    expect(prompt).toContain('- I care about CI cost.');
    expect(prompt).not.toContain('github_data');
  });

  it('treats no change, an unchanged text and a runaway text as no proposal', async () => {
    const { runner, service } = setup();
    runner.answer('instructions_change', { reply: 'That is a one-off question.', change: null });
    runner.answer('instructions_change', { reply: '', change: { text: input.instructions, summary: 'same' } });
    runner.answer('instructions_change', { reply: '', change: { text: 'x'.repeat(30_000), summary: 'long' } });

    expect(await service.proposeInstructionsChange(input)).toEqual({ reply: 'That is a one-off question.', change: null });
    expect((await service.proposeInstructionsChange(input)).change).toBeNull();
    expect((await service.proposeInstructionsChange(input)).change).toBeNull();
  });
});

describe('RunnerAgentService observer', () => {
  it('reports every call, including answers that do not parse', async () => {
    const calls: ObservedCall[] = [];
    const runner = new FakeRunner();
    const service = new RunnerAgentService(runner, { now: () => NOW, observer: { onCall: (call) => calls.push(call) } });
    const input = { prs: [makePr()], viewer, topics: [], context: emptyContext };
    runner.answer('topic_assignment', { assignments: [] }).answer('topic_assignment', 'not json');

    await service.assignTopics(input);
    await expect(service.assignTopics(input)).rejects.toBeInstanceOf(AgentOutputError);

    expect(calls.map((call) => [call.purpose, call.ok, call.attempt])).toEqual([
      ['topic_assignment', true, 1],
      ['topic_assignment', false, 1],
    ]);
  });
});

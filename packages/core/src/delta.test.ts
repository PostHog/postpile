import { describe, expect, it } from 'vitest';
import { DELTA_LIMITS, isEmptyDelta, selectTopicDelta, type TopicDeltaInput } from './delta.ts';
import { emptyDossier } from './dossier.ts';
import { at, makeDossierVersion, makeEvent, makeFact } from './fixtures.ts';
import type { LoggedEvent, TopicDelta } from './memory.ts';
import type { Feedback, PrEvent } from './types.ts';

const empty: TopicDelta = {
  topicId: 'ci',
  fromSeq: 10,
  toSeq: 10,
  skipToSeq: 10,
  events: [],
  omittedEvents: 0,
  joinedPrKeys: [],
  leftPrKeys: [],
  staleFactIds: [],
  staleClaims: [],
  newFeedback: [],
};

describe('isEmptyDelta', () => {
  it('is empty only when nothing at all is new', () => {
    expect(isEmptyDelta(empty)).toBe(true);
    expect(isEmptyDelta({ ...empty, joinedPrKeys: ['a/b#1'] })).toBe(false);
    expect(isEmptyDelta({ ...empty, staleFactIds: ['f1'] })).toBe(false);
    expect(isEmptyDelta({ ...empty, omittedEvents: 3 })).toBe(false);
  });
});

const pr1 = 'acme/app#1';
const pr2 = 'acme/app#2';

function logged(seq: number, prKey: string, overrides: Partial<PrEvent> = {}): LoggedEvent {
  return { seq, event: makeEvent({ id: `${prKey}:comment:${seq}`, prKey, sourceId: String(seq), ...overrides }) };
}

function feedback(id: number, createdAt: string): Feedback {
  return { id, kind: 'wrong_topic', topicId: 'ci', tileId: null, prKey: null, setId: null, eventId: null, note: '', createdAt };
}

function input(overrides: Partial<TopicDeltaInput> = {}): TopicDeltaInput {
  const dossier = { ...emptyDossier(), timeline: [{ prKey: pr1, role: 'image' }, { prKey: pr2, role: 'docker' }] };
  return {
    topicId: 'ci',
    cursorSeq: 10,
    memberKeys: [pr1, pr2],
    memberSince: new Map(),
    logged: [],
    joinedHistory: [],
    previous: makeDossierVersion({ topicId: 'ci', dossier, createdAt: at(50), throughSeq: 10 }),
    staleFacts: [],
    staleClaims: [],
    feedback: [],
    ...overrides,
  };
}

describe('selectTopicDelta', () => {
  it('is empty when nothing happened since the cursor', () => {
    const delta = selectTopicDelta(input({ logged: [logged(9, pr1)] }));
    expect(isEmptyDelta(delta)).toBe(true);
    expect(delta).toMatchObject({ fromSeq: 10, toSeq: 10 });
  });

  it('takes new events of member PRs, oldest seq first', () => {
    const delta = selectTopicDelta(input({ logged: [logged(13, pr2), logged(11, pr1), logged(12, 'x/y#9')] }));
    expect(delta.events.map((event) => event.id)).toEqual([`${pr1}:comment:11`, `${pr2}:comment:13`]);
    expect(delta.toSeq).toBe(13);
  });

  it('drops muted events but still moves the cursor past them', () => {
    const delta = selectTopicDelta(
      input({
        logged: [
          logged(11, pr1, { ruleLoudness: 'muted' }),
          logged(12, pr1, { isBot: true, ruleLoudness: 'quiet' }),
          logged(13, pr1, { ruleLoudness: 'muted', override: { loudness: 'loud', reason: 'unmuted', by: 'user' } }),
          logged(14, pr1, { ruleLoudness: 'loud', override: { loudness: 'muted', reason: 'noise', by: 'agent' } }),
        ],
      }),
    );
    expect(delta.events.map((event) => event.sourceId)).toEqual(['12', '13']);
    expect(delta.omittedEvents).toBe(0);
    expect(delta.toSeq).toBe(14);
  });

  it('drops CI results, so a CI-only change starts no dossier update, and still moves the cursor', () => {
    const ci = { kind: 'ci', actor: '', isBot: true, ruleLoudness: 'quiet', summary: 'CI failed: test' } as const;
    const onlyCi = selectTopicDelta(input({ logged: [logged(11, pr1, ci), logged(12, pr2, ci)] }));
    expect(isEmptyDelta(onlyCi)).toBe(true);
    expect(onlyCi.toSeq).toBe(12);
    const mixed = selectTopicDelta(input({ logged: [logged(11, pr1, ci), logged(12, pr1)] }));
    expect(mixed.events.map((event) => event.sourceId)).toEqual(['12']);
  });

  it('lets review bot comments ride along: alone they start nothing and keep the cursor before them', () => {
    const rabbit = { kind: 'bot_comment', actor: 'coderabbitai[bot]', isBot: true, ruleLoudness: 'quiet' } as const;
    const alone = selectTopicDelta(input({ logged: [logged(11, pr1, rabbit)] }));
    expect(isEmptyDelta(alone)).toBe(true);
    expect(alone.skipToSeq).toBe(10);
    const withPerson = selectTopicDelta(input({ logged: [logged(11, pr1, rabbit), logged(12, pr1)] }));
    expect(isEmptyDelta(withPerson)).toBe(false);
    expect(withPerson.events.map((event) => event.sourceId)).toEqual(['11', '12']);
  });

  it('skips past noise up to the first ride-along event, never past it', () => {
    const edit = { kind: 'comment_edited', actor: 'trunk-io[bot]', isBot: true, ruleLoudness: 'quiet' } as const;
    const report = { kind: 'bot_comment', actor: 'github-actions[bot]', isBot: true, ruleLoudness: 'quiet' } as const;
    const onlyNoise = selectTopicDelta(input({ logged: [logged(11, pr1, edit), logged(12, pr2, edit)] }));
    expect(isEmptyDelta(onlyNoise)).toBe(true);
    expect(onlyNoise.events).toEqual([]);
    expect(onlyNoise.skipToSeq).toBe(12);
    const mixed = selectTopicDelta(input({ logged: [logged(11, pr1, edit), logged(12, pr1, report), logged(13, pr1, edit)] }));
    expect(isEmptyDelta(mixed)).toBe(true);
    expect(mixed.skipToSeq).toBe(11);
    expect(mixed.toSeq).toBe(13);
  });

  it('caps a big delta per PR and overall, newest kept, rest counted', () => {
    const many: LoggedEvent[] = [];
    let seq = 10;
    for (let pr = 1; pr <= 10; pr += 1) {
      for (let i = 0; i < 20; i += 1) {
        seq += 1;
        many.push(logged(seq, `acme/app#${pr}`));
      }
    }
    const memberKeys = Array.from({ length: 10 }, (_, i) => `acme/app#${i + 1}`);
    const delta = selectTopicDelta(input({ memberKeys, logged: many }));
    expect(delta.events).toHaveLength(DELTA_LIMITS.maxEvents);
    expect(delta.omittedEvents).toBe(200 - DELTA_LIMITS.maxEvents);
    expect(delta.toSeq).toBe(210);
    const perPr = delta.events.filter((event) => event.prKey === 'acme/app#10');
    expect(perPr).toHaveLength(DELTA_LIMITS.maxEventsPerPr);
    expect(perPr.at(-1)?.sourceId).toBe('210');
    expect(delta.events.some((event) => event.prKey === 'acme/app#1')).toBe(false);
  });

  it('does not cap a delta under the limit, even when one PR is busy', () => {
    const busy = Array.from({ length: 40 }, (_, i) => logged(11 + i, pr1));
    const delta = selectTopicDelta(input({ logged: busy }));
    expect(delta.events).toHaveLength(40);
    expect(delta.omittedEvents).toBe(0);
  });

  it('lists joined and left PRs against the previous timeline', () => {
    const delta = selectTopicDelta(input({ memberKeys: [pr1, 'acme/app#3'] }));
    expect(delta.joinedPrKeys).toEqual(['acme/app#3']);
    expect(delta.leftPrKeys).toEqual([pr2]);
  });

  it('does not offer a member again that the previous version already knew about', () => {
    const pr3 = 'acme/app#3';
    const pr4 = 'acme/app#4';
    const memberSince = new Map([
      [pr3, at(40)],
      [pr4, at(60)],
    ]);
    const delta = selectTopicDelta(input({ memberKeys: [pr1, pr2, pr3, pr4], memberSince }));
    expect(delta.joinedPrKeys).toEqual([pr4]);
  });

  it('reads the older history of a joined PR once, next to the new events', () => {
    const pr3 = 'acme/app#3';
    const delta = selectTopicDelta(
      input({
        memberKeys: [pr1, pr2, pr3],
        logged: [logged(12, pr1)],
        joinedHistory: [logged(4, pr3), logged(8, pr3, { ruleLoudness: 'muted' }), logged(11, pr3), logged(5, pr1)],
      }),
    );
    expect(delta.joinedPrKeys).toEqual([pr3]);
    expect(delta.events.map((event) => event.sourceId)).toEqual(['4', '12']);
    expect(delta.toSeq).toBe(12);
  });

  it('treats every member as joined when there is no dossier yet', () => {
    const delta = selectTopicDelta(input({ previous: null, cursorSeq: 0 }));
    expect(delta.joinedPrKeys).toEqual([pr1, pr2]);
    expect(delta.leftPrKeys).toEqual([]);
  });

  it('passes stale facts and claims, and keeps only feedback newer than the previous version', () => {
    const delta = selectTopicDelta(
      input({
        staleFacts: [makeFact({ id: 'f7' })],
        staleClaims: [{ path: 'timeline[0]', reason: 'left_topic' }],
        feedback: [feedback(3, at(60)), feedback(2, at(40))],
      }),
    );
    expect(delta.staleFactIds).toEqual(['f7']);
    expect(delta.staleClaims).toEqual([{ path: 'timeline[0]', reason: 'left_topic' }]);
    expect(delta.newFeedback.map((entry) => entry.id)).toEqual([3]);
  });
});

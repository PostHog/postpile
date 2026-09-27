import { describe, expect, it } from 'vitest';
import { mergeRefs, normaliseFactText, preReconcile } from './fact-rules.ts';
import { at, makeCandidate, makeFact, makeFactRef } from './fixtures.ts';

const topic = { kind: 'initiative' as const, key: 'topic-1' };

describe('normaliseFactText', () => {
  it('ignores case, spacing and trailing punctuation', () => {
    expect(normaliseFactText('  Alice   works on #1. ')).toBe(normaliseFactText('alice works on #1'));
  });
});

describe('mergeRefs', () => {
  it('drops refs that point at the same source', () => {
    const a = makeFactRef({ kind: 'comment', sourceId: 'c1' });
    const b = makeFactRef({ kind: 'comment', sourceId: 'c2' });
    expect(mergeRefs([a], [{ ...a, url: 'other' }, b])).toEqual([a, b]);
  });
});

describe('preReconcile', () => {
  it('1: the same statement again is a noop that merges refs', () => {
    const existing = makeFact({ id: 'f1' });
    const ref = makeFactRef({ kind: 'comment', sourceId: 'c9' });
    const result = preReconcile([makeCandidate({ text: 'Alice works on PostHog/posthog#1.', refs: [ref] })], [existing]);
    expect(result).toEqual({ actions: [{ kind: 'noop', factId: 'f1', refs: [ref] }], ambiguous: [] });
  });

  it('2: a newer value for a per-subject predicate updates the old fact', () => {
    const old = makeFact({ id: 's1', subject: topic, predicate: 'status', object: null, text: 'active', validFrom: at(1) });
    const candidate = makeCandidate({ subject: topic, predicate: 'status', object: null, text: 'blocked on the image', validFrom: at(30) });
    const result = preReconcile([candidate], [old]);
    expect(result.ambiguous).toEqual([]);
    expect(result.actions).toEqual([
      { kind: 'update', factId: 's1', candidate, reason: 'replaced by a newer status fact' },
    ]);
  });

  it('2: a new driver replaces the old one (per object, other subject)', () => {
    const old = makeFact({ id: 'd1', subject: { kind: 'person', key: 'alice' }, predicate: 'drives', object: topic, text: 'alice drives it', validFrom: at(1) });
    const candidate = makeCandidate({ subject: { kind: 'person', key: 'carol' }, predicate: 'drives', object: topic, text: 'carol took over', validFrom: at(40) });
    const result = preReconcile([candidate], [old]);
    expect(result.actions).toEqual([{ kind: 'update', factId: 'd1', candidate, reason: 'replaced by a newer drives fact' }]);
  });

  it('2: older leftovers in a unique slot are invalidated', () => {
    const a = makeFact({ id: 'a', subject: topic, predicate: 'status', object: null, text: 'one', validFrom: at(1) });
    const b = makeFact({ id: 'b', subject: topic, predicate: 'status', object: null, text: 'two', validFrom: at(2) });
    const candidate = makeCandidate({ subject: topic, predicate: 'status', object: null, text: 'three', validFrom: at(3) });
    const { actions } = preReconcile([candidate], [a, b]);
    expect(actions.map((action) => [action.kind, 'factId' in action ? action.factId : null])).toEqual([
      ['update', 'b'],
      ['invalidate', 'a'],
    ]);
  });

  it('5: a unique slot held by a newer fact goes to the agent', () => {
    const newer = makeFact({ id: 's1', subject: topic, predicate: 'status', object: null, text: 'finished', validFrom: at(50) });
    const candidate = makeCandidate({ subject: topic, predicate: 'status', object: null, text: 'active', validFrom: at(10) });
    const result = preReconcile([candidate], [newer]);
    expect(result.actions).toEqual([]);
    expect(result.ambiguous).toEqual([{ candidate, existing: [newer] }]);
  });

  it('3: same subject, predicate and object with other words is ambiguous', () => {
    const existing = makeFact({ id: 'f1', predicate: 'decided', subject: topic, object: null, text: 'keep GitHub runners for releases' });
    const candidate = makeCandidate({ predicate: 'decided', subject: topic, object: null, text: 'release builds stay on GitHub runners' });
    const result = preReconcile([candidate], [existing]);
    expect(result.actions).toEqual([]);
    expect(result.ambiguous).toEqual([{ candidate, existing: [existing] }]);
  });

  it('4: nothing in the way is an add, also for another object of a non-unique predicate', () => {
    const existing = makeFact({ id: 'f1' });
    const first = makeCandidate({ subject: { kind: 'person', key: 'bob' } });
    const second = makeCandidate({ object: { kind: 'pr', key: 'PostHog/posthog#2' }, text: 'alice works on #2' });
    const result = preReconcile([first, second], [existing]);
    expect(result.actions).toEqual([
      { kind: 'add', candidate: first },
      { kind: 'add', candidate: second },
    ]);
  });

  it('merges duplicate candidates of one answer before deciding', () => {
    const a = makeCandidate({ refs: [makeFactRef({ kind: 'comment', sourceId: 'c1' })], validFrom: at(20) });
    const b = makeCandidate({ text: 'alice works on posthog/posthog#1', refs: [makeFactRef({ kind: 'comment', sourceId: 'c2' })], validFrom: at(15) });
    const { actions } = preReconcile([a, b], []);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      kind: 'add',
      candidate: { refs: [{ sourceId: 'c1' }, { sourceId: 'c2' }], validFrom: at(15) },
    });
  });
});

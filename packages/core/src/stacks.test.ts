import { describe, expect, it } from 'vitest';
import { at, makePr } from './fixtures.ts';
import { buildStacks, stackTopicId } from './stacks.ts';
import type { TopicMembership } from './types.ts';

describe('buildStacks', () => {
  it('chains PRs whose base is another PR head, bottom first', () => {
    const prs = [
      makePr({ number: 3, baseRef: 'b2', headRef: 'b3' }),
      makePr({ number: 1, baseRef: 'master', headRef: 'b1' }),
      makePr({ number: 2, baseRef: 'b1', headRef: 'b2' }),
    ];
    expect(buildStacks(prs)).toEqual([
      {
        id: 'stack:acme/app#1',
        repo: 'acme/app',
        prKeys: ['acme/app#1', 'acme/app#2', 'acme/app#3'],
      },
    ]);
  });

  it('ignores lone PRs', () => {
    expect(buildStacks([makePr({ number: 1 }), makePr({ number: 2 })])).toEqual([]);
  });

  it('does not chain across repos', () => {
    const prs = [
      makePr({ number: 1, repo: 'acme/a', headRef: 'feat' }),
      makePr({ number: 2, repo: 'acme/b', baseRef: 'feat', headRef: 'feat-2' }),
    ];
    expect(buildStacks(prs)).toEqual([]);
  });

  it('keeps merged layers of any age and closed layers, in order, but never a stack without an open PR', () => {
    const prs = [
      makePr({ number: 1, headRef: 'b1', state: 'MERGED', mergedAt: '2025-01-10T00:00:00.000Z', createdAt: '2025-01-01T00:00:00.000Z' }),
      makePr({ number: 2, baseRef: 'b1', headRef: 'b2', state: 'CLOSED', createdAt: '2025-01-02T00:00:00.000Z', updatedAt: '2025-02-01T00:00:00.000Z' }),
      makePr({ number: 3, baseRef: 'b2', headRef: 'b3', isDraft: true, createdAt: '2025-01-03T00:00:00.000Z' }),
      makePr({ number: 7, headRef: 'b7', state: 'MERGED', mergedAt: '2026-09-18T00:00:00.000Z' }),
      makePr({ number: 8, baseRef: 'b7', headRef: 'b8', state: 'MERGED', mergedAt: '2026-09-19T00:00:00.000Z' }),
    ];
    expect(buildStacks(prs).map((s) => s.prKeys)).toEqual([['acme/app#1', 'acme/app#2', 'acme/app#3']]);
  });

  it('keeps a merged layer after GitHub moved the PR above onto the next branch down', () => {
    const prs = [
      makePr({ number: 1, headRef: 'b1', state: 'MERGED', mergedAt: at(60) }),
      makePr({ number: 2, baseRef: 'master', headRef: 'b2', previousBaseRefs: ['b1'], createdAt: at(10) }),
      makePr({ number: 3, baseRef: 'b2', headRef: 'b3', createdAt: at(20) }),
    ];
    expect(buildStacks(prs).map((s) => s.prKeys)).toEqual([['acme/app#1', 'acme/app#2', 'acme/app#3']]);
  });

  it('does not follow a former base to a PR that is still open', () => {
    const prs = [
      makePr({ number: 1, headRef: 'b1' }),
      makePr({ number: 2, baseRef: 'master', headRef: 'b2', previousBaseRefs: ['b1'] }),
    ];
    expect(buildStacks(prs)).toEqual([]);
  });

  it('leaves out a merged or closed PR that ended before the PR on its branch was opened', () => {
    const prs = [
      makePr({ number: 1, headRef: 'reused', state: 'MERGED', mergedAt: at(5), createdAt: at(0) }),
      makePr({ number: 4, headRef: 'old', state: 'CLOSED', createdAt: at(0), updatedAt: at(5) }),
      makePr({ number: 2, baseRef: 'reused', headRef: 'b2', createdAt: at(30) }),
      makePr({ number: 5, baseRef: 'old', headRef: 'b5', createdAt: at(30) }),
    ];
    expect(buildStacks(prs)).toEqual([]);
  });

  it('takes one PR per head branch: open over merged over closed', () => {
    const prs = [
      makePr({ number: 1, headRef: 'b1', state: 'CLOSED', updatedAt: at(100) }),
      makePr({ number: 2, headRef: 'b1' }),
      makePr({ number: 3, baseRef: 'b1', headRef: 'b3' }),
    ];
    expect(buildStacks(prs).map((s) => s.prKeys)).toEqual([['acme/app#2', 'acme/app#3']]);
  });

  it('continues a fork with the lowest number; the other branch stands alone', () => {
    const prs = [
      makePr({ number: 1, headRef: 'b1' }),
      makePr({ number: 5, baseRef: 'b1', headRef: 'b5' }),
      makePr({ number: 2, baseRef: 'b1', headRef: 'b2' }),
      makePr({ number: 6, baseRef: 'b5', headRef: 'b6' }),
    ];
    expect(buildStacks(prs).map((s) => s.prKeys)).toEqual([
      ['acme/app#1', 'acme/app#2'],
      ['acme/app#5', 'acme/app#6'],
    ]);
  });

  it('survives a base/head cycle', () => {
    const prs = [makePr({ number: 1, baseRef: 'b2', headRef: 'b1' }), makePr({ number: 2, baseRef: 'b1', headRef: 'b2' })];
    expect(buildStacks(prs)).toEqual([]);
  });
});

describe('stackTopicId', () => {
  const stack = { id: 'stack:a#1', repo: 'a', prKeys: ['a#1', 'a#2', 'a#3'] };

  function membership(prKey: string, topicId: string, minutes: number): [string, TopicMembership] {
    return [prKey, { prKey, topicId, assignedBy: 'agent', reason: '', createdAt: at(minutes) }];
  }

  it('picks the topic of the newest layer membership', () => {
    const memberships = new Map([membership('a#1', 'depot', 0), membership('a#3', 'billing', 10)]);
    expect(stackTopicId(stack, memberships)).toBe('billing');
  });

  it('is null while no layer has a topic', () => {
    expect(stackTopicId(stack, new Map())).toBeNull();
  });
});

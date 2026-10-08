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

  it('continues a fork with the open PR over a closed one, so the open layers above stay in the stack', () => {
    const prs = [
      makePr({ number: 1, headRef: 'b1' }),
      makePr({ number: 2, baseRef: 'b1', headRef: 'b2', state: 'CLOSED', createdAt: at(0), updatedAt: at(10) }),
      makePr({ number: 5, baseRef: 'b1', headRef: 'b5', createdAt: at(20) }),
      makePr({ number: 6, baseRef: 'b5', headRef: 'b6', createdAt: at(20) }),
    ];
    expect(buildStacks(prs).map((s) => s.prKeys)).toEqual([['acme/app#1', 'acme/app#5', 'acme/app#6']]);
  });

  it('survives a base/head cycle', () => {
    const prs = [makePr({ number: 1, baseRef: 'b2', headRef: 'b1' }), makePr({ number: 2, baseRef: 'b1', headRef: 'b2' })];
    expect(buildStacks(prs)).toEqual([]);
  });
});

describe('buildStacks with forks', () => {
  it('never links a PR from a fork, whose branch name belongs to the fork', () => {
    const prs = [
      makePr({ number: 1, baseRef: 'master', headRef: 'patch-1' }),
      makePr({ number: 2, baseRef: 'patch-1', headRef: 'b2' }),
      // An open fork PR from its own patch-1 would win the head over #1 and break the stack.
      makePr({ number: 3, baseRef: 'master', headRef: 'patch-1', isCrossRepository: true }),
      // A fork PR from main would sit on nothing here, but must not chain to a same-repo main either.
      makePr({ number: 4, baseRef: 'b2', headRef: 'main', isCrossRepository: true }),
    ];
    expect(buildStacks(prs).map((s) => s.prKeys)).toEqual([['acme/app#1', 'acme/app#2']]);
  });

  it('reads a snapshot without the field as same-repo', () => {
    const prs = [makePr({ number: 1, headRef: 'b1' }), makePr({ number: 2, baseRef: 'b1', headRef: 'b2' })];
    expect(buildStacks(prs).map((s) => s.prKeys)).toEqual([['acme/app#1', 'acme/app#2']]);
  });
});

/** A PR whose body declares `parent` as the layer below (`declaredParentOf`). */
function declaring(pr: ReturnType<typeof makePr>, parent: number) {
  return { ...pr, declaredParent: parent };
}

describe('buildStacks with layers declared in the body', () => {
  it('links a PR on the default branch to the parent its body declares', () => {
    const prs = [makePr({ number: 1, isDraft: true }), declaring(makePr({ number: 2 }), 1)];
    expect(buildStacks(prs)).toEqual([
      { id: 'stack:acme/app#1', repo: 'acme/app', prKeys: ['acme/app#1', 'acme/app#2'], declaredLinks: ['acme/app#2'] },
    ]);
  });

  it('chains a declared link on top of a branch stack', () => {
    const prs = [
      makePr({ number: 1, headRef: 'b1' }),
      makePr({ number: 2, baseRef: 'b1', headRef: 'b2' }),
      declaring(makePr({ number: 3 }), 2),
    ];
    expect(buildStacks(prs)).toEqual([
      { id: 'stack:acme/app#1', repo: 'acme/app', prKeys: ['acme/app#1', 'acme/app#2', 'acme/app#3'], declaredLinks: ['acme/app#3'] },
    ]);
  });

  it('lets a branch link win over a declared one', () => {
    const prs = [makePr({ number: 1, headRef: 'b1' }), makePr({ number: 5 }), declaring(makePr({ number: 2, baseRef: 'b1' }), 5)];
    expect(buildStacks(prs)).toEqual([{ id: 'stack:acme/app#1', repo: 'acme/app', prKeys: ['acme/app#1', 'acme/app#2'] }]);
  });

  it('ignores a parent that is not stored, in another repo, or the PR itself', () => {
    expect(buildStacks([declaring(makePr({ number: 2 }), 9)])).toEqual([]);
    expect(buildStacks([declaring(makePr({ number: 2 }), 2)])).toEqual([]);
    expect(buildStacks([makePr({ number: 1, repo: 'acme/infra' }), declaring(makePr({ number: 2 }), 1)])).toEqual([]);
  });

  it('leaves out a parent that merged before the PR was opened', () => {
    const prs = [makePr({ number: 1, state: 'MERGED', mergedAt: at(5) }), declaring(makePr({ number: 2, createdAt: at(10) }), 1)];
    expect(buildStacks(prs)).toEqual([]);
  });

  it('links fork PRs by declaration, as the declared PR and as the declaring one', () => {
    const forkParent = makePr({ number: 1, headRef: 'main', isCrossRepository: true });
    expect(buildStacks([forkParent, declaring(makePr({ number: 2 }), 1)])).toEqual([
      { id: 'stack:acme/app#1', repo: 'acme/app', prKeys: ['acme/app#1', 'acme/app#2'], declaredLinks: ['acme/app#2'] },
    ]);
    const forkChild = declaring(makePr({ number: 4, headRef: 'main', isCrossRepository: true }), 3);
    expect(buildStacks([makePr({ number: 3 }), forkChild]).map((stack) => stack.prKeys)).toEqual([['acme/app#3', 'acme/app#4']]);
  });

  it('still never links a fork PR by branch, even with a declaration elsewhere in the repo', () => {
    const prs = [
      makePr({ number: 1, headRef: 'b1' }),
      makePr({ number: 2, baseRef: 'b1', headRef: 'b2' }),
      // Two fork PRs on the same head name: both stay, neither takes #1's place nor links by branch.
      makePr({ number: 3, baseRef: 'b2', headRef: 'b1', isCrossRepository: true }),
      makePr({ number: 5, baseRef: 'master', headRef: 'b1', isCrossRepository: true }),
    ];
    expect(buildStacks(prs).map((stack) => stack.prKeys)).toEqual([['acme/app#1', 'acme/app#2']]);
  });

  it('drops the declared link that would close a loop, keeping the rest', () => {
    const prs = [declaring(makePr({ number: 1 }), 2), declaring(makePr({ number: 2 }), 1)];
    expect(buildStacks(prs)).toEqual([
      { id: 'stack:acme/app#2', repo: 'acme/app', prKeys: ['acme/app#2', 'acme/app#1'], declaredLinks: ['acme/app#1'] },
    ]);
  });

  it('drops a declared link onto its own branch stack', () => {
    const prs = [declaring(makePr({ number: 1, headRef: 'b1' }), 2), makePr({ number: 2, baseRef: 'b1', headRef: 'b2' })];
    expect(buildStacks(prs)).toEqual([{ id: 'stack:acme/app#1', repo: 'acme/app', prKeys: ['acme/app#1', 'acme/app#2'] }]);
  });
});

describe('stackTopicId', () => {
  const stack = { id: 'stack:a#1', repo: 'a', prKeys: ['a#1', 'a#2', 'a#3'] };

  function membership(prKey: string, topicId: string, minutes: number): [string, TopicMembership] {
    return [prKey, { prKey, topicId, assignedBy: 'agent', reason: '', createdAt: at(minutes) }];
  }

  it('picks the topic of the newest layer membership', () => {
    const memberships = new Map([membership('a#1', 'depot', 0), membership('a#3', 'billing', 10)]);
    expect(stackTopicId(stack, memberships, new Set(['depot', 'billing']))).toBe('billing');
  });

  it('skips a newer membership in a topic that is not active, so the stack still shows', () => {
    const memberships = new Map([membership('a#1', 'depot', 0), membership('a#3', 'retired-topic', 10)]);
    expect(stackTopicId(stack, memberships, new Set(['depot']))).toBe('depot');
  });

  it('stays with the newest topic when none of the layer topics is active', () => {
    const memberships = new Map([membership('a#1', 'old', 0), membership('a#3', 'older', 10)]);
    expect(stackTopicId(stack, memberships, new Set(['depot']))).toBe('older');
  });

  it('is null while no layer has a topic', () => {
    expect(stackTopicId(stack, new Map(), new Set(['depot']))).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { at, makeComment, makePr, makeThread, makeTimelineItem } from './fixtures.ts';
import { isQueued, openThreadCount, prStatus } from './pr-status.ts';

describe('prStatus', () => {
  it('has lifecycle and review for an open PR', () => {
    const pr = makePr({ reviewDecision: 'APPROVED', checks: { rollup: 'SUCCESS', contexts: [] } });
    expect(prStatus(pr)).toEqual({ lifecycle: 'open', review: 'approved', agentApprovers: [], mergeQueue: null, icon: 'open' });
  });

  it('maps changes and never carries checks: CI is not a signal', () => {
    expect(prStatus(makePr({ reviewDecision: 'CHANGES_REQUESTED', checks: { rollup: 'FAILURE', contexts: [] } }))).toEqual({
      lifecycle: 'open',
      review: 'changes',
      agentApprovers: [],
      mergeQueue: null,
      icon: 'open',
    });
  });

  it('leaves out parts that do not apply', () => {
    expect(prStatus(makePr({ reviewDecision: 'NONE' }))).toEqual({ lifecycle: 'open', review: null, agentApprovers: [], mergeQueue: null, icon: 'open' });
    expect(prStatus(makePr({ isDraft: true, checks: { rollup: 'SUCCESS', contexts: [] } }))).toEqual({
      lifecycle: 'draft',
      review: null,
      agentApprovers: [],
      mergeQueue: null,
      icon: 'draft',
    });
    expect(prStatus(makePr({ state: 'MERGED', reviewDecision: 'APPROVED' }))).toEqual({
      lifecycle: 'merged',
      review: null,
      agentApprovers: [],
      mergeQueue: null,
      icon: 'merged',
    });
    expect(prStatus(makePr({ state: 'CLOSED' })).lifecycle).toBe('closed');
  });

  it('shows queued while the newest queue entry is an add', () => {
    const added = makeTimelineItem({ id: 'q1', kind: 'added_to_merge_queue', subject: null });
    const removed = makeTimelineItem({ id: 'q2', kind: 'removed_from_merge_queue', subject: null });
    expect(isQueued(makePr({ timeline: [added] }))).toBe(true);
    expect(isQueued(makePr({ timeline: [added, removed] }))).toBe(false);
    expect(prStatus(makePr({ timeline: [added] }))).toMatchObject({ lifecycle: 'queued', icon: 'merge_queue', mergeQueue: null });
  });

  it("swaps the open icon for the queue icon from trunk's comment: amber in it, red once out, merged as merged", () => {
    const trunk = (body: string) => makeComment({ id: 't1', author: 'trunk-io[bot]', body, createdAt: at(5) });
    const testing = trunk('🧪\u2002Running tests on this pull request - [details](https://trunk.example/1).');
    const failed = trunk('Stacked PR [12](https://github.com/acme/app/pull/12) failed testing in the merge queue. Please investigate the failure and re-submit the stack.');
    expect(prStatus(makePr({ reviewDecision: 'APPROVED', comments: [testing] }))).toMatchObject({
      lifecycle: 'open',
      review: 'approved',
      mergeQueue: { state: 'testing', since: at(5) },
      icon: 'merge_queue',
    });
    expect(prStatus(makePr({ comments: [failed] }))).toMatchObject({ mergeQueue: { state: 'failed', reason: 'tests failed' }, icon: 'merge_queue_failed' });
    expect(prStatus(makePr({ state: 'MERGED', comments: [testing] }))).toMatchObject({ mergeQueue: null, icon: 'merged' });
    expect(prStatus(makePr({ isDraft: true, comments: [failed] }))).toMatchObject({ mergeQueue: null, icon: 'draft' });
  });
});

describe('openThreadCount', () => {
  it('counts unresolved threads only', () => {
    const open = makeThread('a', [makeComment()]);
    const resolved = { ...makeThread('b', [makeComment()]), isResolved: true };
    expect(openThreadCount(makePr({ threads: [open, resolved, open] }))).toBe(2);
  });
});

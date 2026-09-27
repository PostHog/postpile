import { describe, expect, it } from 'vitest';
import { makeComment, makePr, makeThread, makeTimelineItem } from './fixtures.ts';
import { isQueued, openThreadCount, prStatus } from './pr-status.ts';

describe('prStatus', () => {
  it('has lifecycle, review and checks for an open PR', () => {
    const pr = makePr({ reviewDecision: 'APPROVED', checks: { rollup: 'SUCCESS', contexts: [] } });
    expect(prStatus(pr)).toEqual({ lifecycle: 'open', review: 'approved', checks: 'ok' });
  });

  it('maps changes, failing and running checks', () => {
    expect(prStatus(makePr({ reviewDecision: 'CHANGES_REQUESTED', checks: { rollup: 'FAILURE', contexts: [] } }))).toEqual({
      lifecycle: 'open',
      review: 'changes',
      checks: 'fail',
    });
    expect(prStatus(makePr({ checks: { rollup: 'PENDING', contexts: [] } })).checks).toBe('pending');
  });

  it('leaves out parts that do not apply', () => {
    expect(prStatus(makePr({ reviewDecision: 'NONE' }))).toEqual({ lifecycle: 'open', review: null, checks: null });
    expect(prStatus(makePr({ isDraft: true, checks: { rollup: 'SUCCESS', contexts: [] } }))).toEqual({
      lifecycle: 'draft',
      review: null,
      checks: 'ok',
    });
    expect(prStatus(makePr({ state: 'MERGED', reviewDecision: 'APPROVED' }))).toEqual({ lifecycle: 'merged', review: null, checks: null });
    expect(prStatus(makePr({ state: 'CLOSED' })).lifecycle).toBe('closed');
  });

  it('shows queued while the newest queue entry is an add', () => {
    const added = makeTimelineItem({ id: 'q1', kind: 'added_to_merge_queue', subject: null });
    const removed = makeTimelineItem({ id: 'q2', kind: 'removed_from_merge_queue', subject: null });
    expect(isQueued(makePr({ timeline: [added] }))).toBe(true);
    expect(isQueued(makePr({ timeline: [added, removed] }))).toBe(false);
    expect(prStatus(makePr({ timeline: [added] })).lifecycle).toBe('queued');
  });
});

describe('openThreadCount', () => {
  it('counts unresolved threads only', () => {
    const open = makeThread('a', [makeComment()]);
    const resolved = { ...makeThread('b', [makeComment()]), isResolved: true };
    expect(openThreadCount(makePr({ threads: [open, resolved, open] }))).toBe(2);
  });
});

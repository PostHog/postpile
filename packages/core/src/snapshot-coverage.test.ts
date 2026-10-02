import { describe, expect, it } from 'vitest';
import { at, makePr, makeThreadFor } from './fixtures.ts';
import { needsOlderPages, snapshotCoversSince } from './snapshot-coverage.ts';
import type { CapHit, Pr } from './types.ts';

const reviewsHit: CapHit = { list: 'reviews', nodes: 50, oldestAt: at(30) };
const threadsHit: CapHit = { list: 'review_threads', nodes: 50, oldestAt: null };

function cut(capHits: CapHit[] | undefined): Pr {
  return makePr({ number: 7, truncated: true, capHits });
}

describe('snapshotCoversSince', () => {
  it('covers everything when nothing was cut, or only GitHub counted more than it returned', () => {
    expect(snapshotCoversSince(makePr({ number: 7 }), at(10))).toBe(true);
    expect(snapshotCoversSince(cut([]), null)).toBe(true);
    // Cut, but stored before the cap evidence was recorded: never vouches.
    expect(snapshotCoversSince(cut(undefined), at(10))).toBe(false);
  });

  it('covers since a time when a newest-N list reaches back to it, not when it starts after it', () => {
    expect(snapshotCoversSince(cut([reviewsHit]), at(30))).toBe(true);
    expect(snapshotCoversSince(cut([reviewsHit]), at(40))).toBe(true);
    expect(snapshotCoversSince(cut([reviewsHit]), at(20))).toBe(false);
    expect(snapshotCoversSince(cut([reviewsHit]), null)).toBe(false);
  });

  it('never trusts review threads or a thread comments by time (oldestAt null), only once paged to the end', () => {
    expect(snapshotCoversSince(cut([threadsHit]), at(1))).toBe(false);
    expect(snapshotCoversSince(cut([{ list: 'thread_comments', nodes: 30, oldestAt: null, threadId: 'RT1' }]), at(1))).toBe(false);
    expect(snapshotCoversSince(cut([{ ...threadsHit, complete: true }]), null)).toBe(true);
  });

  it('needs every capped list covered: a complete one does not vouch for another that stops short', () => {
    expect(snapshotCoversSince(cut([{ ...threadsHit, complete: true }, reviewsHit]), at(40))).toBe(true);
    expect(snapshotCoversSince(cut([{ ...threadsHit, complete: true }, reviewsHit]), at(20))).toBe(false);
  });
});

describe('needsOlderPages', () => {
  it('pages an unread thread whose snapshot stops short of its read time, never a read or covered one', () => {
    const pr = cut([reviewsHit, threadsHit]);
    expect(needsOlderPages(makeThreadFor(pr, { unread: true, lastReadAt: at(20) }), pr)).toBe(true);
    expect(needsOlderPages(makeThreadFor(pr, { unread: false, lastReadAt: at(20) }), pr)).toBe(false);
    const covered = cut([reviewsHit]);
    expect(needsOlderPages(makeThreadFor(covered, { unread: true, lastReadAt: at(40) }), covered)).toBe(false);
  });
});

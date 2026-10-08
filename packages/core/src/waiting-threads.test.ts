import { describe, expect, it } from 'vitest';
import { at, makeComment, makePr, makeThread, viewer } from './fixtures.ts';
import { waitingThreads } from './waiting-threads.ts';

const me = viewer.login;

describe('waitingThreads', () => {
  const threads = [
    makeThread('t1', [makeComment({ id: 'c1', author: 'mira', body: 'Why a flag here?', createdAt: at(1) })]),
    makeThread('t2', [makeComment({ id: 'c2', author: me, createdAt: at(2) }), makeComment({ id: 'c3', author: 'bob', body: '👍', createdAt: at(5) })]),
    makeThread('t3', [makeComment({ id: 'c4', author: 'mira', createdAt: at(3) }), makeComment({ id: 'c5', author: me, createdAt: at(4) })]),
    { ...makeThread('t4', [makeComment({ id: 'c6', author: 'ada', createdAt: at(6) })]), isResolved: true },
    makeThread('t5', [makeComment({ id: 'c7', author: 'reviewbot[bot]', createdAt: at(7) })]),
  ];

  it('lists threads whose last word waits on the user, newest first, with the last comment', () => {
    const waiting = waitingThreads(makePr({ author: me, threads }), viewer);
    expect(waiting.map((thread) => [thread.threadId, thread.author, thread.body])).toEqual([
      ['t2', 'bob', '👍'],
      ['t1', 'mira', 'Why a flag here?'],
    ]);
    expect(waiting[0]).toMatchObject({ path: 'a.ts', at: at(5) });
  });

  it("is empty on someone else's PR: its threads are the author's to answer", () => {
    expect(waitingThreads(makePr({ author: 'rowan', threads }), viewer)).toEqual([]);
  });

  it('is empty without a viewer', () => {
    expect(waitingThreads(makePr({ author: me, threads }), null)).toEqual([]);
  });
});

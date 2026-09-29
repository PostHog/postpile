import { describe, expect, it } from 'vitest';
import { tileAfterMarkRead } from './after-read.ts';
import { at, makeCommit, makeEvent, makePr, makeReview, makeUserState, singleTile, viewer } from './fixtures.ts';
import { tileListRank } from './tile-view.ts';
import type { Pr, PrEvent, UserPrState } from './types.ts';
import { NO_TURN } from './whose-turn.ts';

function afterRead(pr: Pr, events: PrEvent[], userStates: UserPrState[] = []) {
  return tileAfterMarkRead({
    tile: singleTile(pr),
    prs: new Map([[pr.key, pr]]),
    events: new Map([[pr.key, events]]),
    userStates: new Map(userStates.map((state) => [state.prKey, state])),
    viewer,
    readAt: at(100),
  });
}

// The viewer asked for changes, the author pushed since: re-review is the viewer's move.
const addressed = makePr({
  author: 'pim',
  headOid: 'c2',
  reviews: [makeReview({ author: viewer.login, state: 'CHANGES_REQUESTED', submittedAt: at(10), commitOid: 'c1' })],
  commits: [makeCommit({ oid: 'c1', author: 'pim', committedAt: at(5) }), makeCommit({ oid: 'c2', author: 'pim', committedAt: at(30) })],
});
const push = makeEvent({ kind: 'commits_pushed', actor: 'pim', at: at(30), ruleLoudness: 'loud' });

describe('tileAfterMarkRead', () => {
  it('stays your move and not done when the author addressed your changes', () => {
    const result = afterRead(addressed, [push]);
    expect(result.done).toBe(false);
    expect(result.turn).toMatchObject({ kind: 'you', what: 'pim addressed your changes: re-review' });
  });

  it('is the same on a tile that is read already', () => {
    const result = afterRead(addressed, [{ ...push, seenAt: at(40) }], [makeUserState({ handledAt: at(40) })]);
    expect(result.done).toBe(false);
    expect(result.turn.kind).toBe('you');
  });

  it('stays not done while a review of you is pending', () => {
    const pr = makePr({ author: 'ada', reviewerUsers: [viewer.login] });
    const request = makeEvent({ kind: 'review_requested', actor: 'ada', at: at(20), ruleLoudness: 'loud' });
    const result = afterRead(pr, [request]);
    expect(result.done).toBe(false);
    expect(result.turn.kind).toBe('you');
  });

  it('is done when a team mention was the only ask: reading answers it', () => {
    const pr = makePr({ author: 'ada' });
    const mention = makeEvent({ kind: 'team_mention', actor: 'ada', at: at(20), ruleLoudness: 'loud' });
    const result = afterRead(pr, [mention]);
    expect(result.done).toBe(true);
    expect(result.turn).toEqual(NO_TURN);
  });

  it('is done on a PR you only follow', () => {
    const comment = makeEvent({ kind: 'comment', actor: 'bob', at: at(20), ruleLoudness: 'loud' });
    expect(afterRead(makePr({ author: 'ada' }), [comment]).done).toBe(true);
  });

  it('never changes the data it gets', () => {
    const events = [push];
    afterRead(addressed, events);
    expect(events[0]!.seenAt).toBeNull();
  });
});

describe('tileListRank', () => {
  const you = { kind: 'you' as const, move: 'review' as const, who: null, what: 'Review', prKey: null };

  it('keeps a read tile that is still your move with the unread ones', () => {
    const unread = tileListRank({ state: { kind: 'unread', unreadBecause: [] }, turn: you });
    expect(tileListRank({ state: { kind: 'open', unreadBecause: [] }, turn: you })).toBe(unread);
  });

  it('puts other open tiles after, then snoozed, then done', () => {
    const ranks = (['open', 'snoozed', 'done'] as const).map((kind) => tileListRank({ state: { kind, unreadBecause: [] }, turn: NO_TURN }));
    expect(ranks).toEqual([1, 2, 3]);
    expect(tileListRank({ state: { kind: 'done', unreadBecause: [] }, turn: you })).toBe(3);
  });
});

// "Your change request holds the PR open" (2026-10-12): an open PR whose
// viewer's newest verdict asks for changes is never done, so its tile never
// folds under Dealt with. Reading it still clears the thread.
import { describe, expect, it } from 'vitest';
import { prAfterMarkRead } from './after-read.ts';
import { at, makeCommit, makeEvent, makePr, makeReview, makeThreadFor, makeUserState, singleTile, viewer } from './fixtures.ts';
import { prMarkAction } from './offers.ts';
import { openedReadCheck } from './quiet-reads.ts';
import { tileGroup } from './tile-groups.ts';
import { changeRequestHoldsOpen, deriveTileState, isPrDone, nothingAskedOfViewer } from './tiles.ts';
import type { FullPr, FullReview, Pr, PrEvent, UserPrState } from './types.ts';

const changesRequested = makeReview({ id: 'r-changes', author: viewer.login, state: 'CHANGES_REQUESTED', submittedAt: at(10), commitOid: 'c1' });
const changesEvent = makeEvent({ id: 'acme/app#1:review:r-changes', kind: 'review_changes_requested', actor: viewer.login, at: at(10) });

/** alice's PR, the viewer asked for changes on c1 and alice has not pushed or replied since. */
function waitingPr(reviews: FullReview[] = [changesRequested], overrides: Partial<FullPr> = {}) {
  return makePr({ author: 'alice', headOid: 'c1', commits: [makeCommit({ oid: 'c1', author: 'alice', committedAt: at(5) })], reviews, ...overrides });
}

/** The viewer read the thread after their review: handled. */
const handled = makeUserState({ handledAt: at(20) });

function tileStateOf(pr: Pr, events: PrEvent[], userState: UserPrState | null, notYours = false) {
  return deriveTileState({
    tile: singleTile(pr),
    prs: new Map([[pr.key, pr]]),
    events: new Map([[pr.key, events]]),
    threads: new Map([[pr.key, makeThreadFor(pr, { unread: false, lastReadAt: at(20) })]]),
    userStates: new Map(userState ? [[pr.key, userState]] : []),
    snoozes: new Map(),
    now: at(100),
    viewer,
    notYours: notYours ? new Set([pr.key]) : new Set(),
  });
}

describe('your change request holds the PR open', () => {
  it('is not done while it waits on the author, though nothing is asked of you', () => {
    const pr = waitingPr();
    expect(changeRequestHoldsOpen(pr, handled, viewer)).toBe(true);
    expect(nothingAskedOfViewer(pr, handled, viewer, [changesEvent])).toBe(true);
    expect(isPrDone(pr, handled, viewer, [changesEvent])).toBe(false);
  });

  it('puts the tile in Open, never Dealt with', () => {
    const state = tileStateOf(waitingPr(), [{ ...changesEvent, seenAt: at(20) }], handled);
    expect(state.kind).toBe('open');
    expect(tileGroup(state)).toBe('open');
  });

  it('keeps holding when the glance says not yours', () => {
    const pr = waitingPr();
    expect(isPrDone(pr, handled, viewer, [changesEvent], true)).toBe(false);
    expect(tileStateOf(pr, [{ ...changesEvent, seenAt: at(20) }], handled, true).kind).toBe('open');
  });

  it('keeps holding after a later comment review: only a verdict changes it', () => {
    const comment = makeReview({ id: 'r-comment', author: viewer.login, state: 'COMMENTED', submittedAt: at(15), commitOid: 'c1' });
    expect(isPrDone(waitingPr([changesRequested, comment]), handled, viewer, [changesEvent])).toBe(false);
  });

  it('keeps holding after a newer change request', () => {
    const again = makeReview({ id: 'r-again', author: viewer.login, state: 'CHANGES_REQUESTED', submittedAt: at(15), commitOid: 'c1' });
    expect(changeRequestHoldsOpen(waitingPr([changesRequested, again]), handled, viewer)).toBe(true);
  });

  it('ends when you approve, on GitHub or in the app', () => {
    const approved = makeReview({ id: 'r-ok', author: viewer.login, state: 'APPROVED', submittedAt: at(15), commitOid: 'c1' });
    expect(isPrDone(waitingPr([changesRequested, approved]), handled, viewer, [changesEvent])).toBe(true);
    // Approved in the app on c2, before GitHub shows that review.
    const pushed = waitingPr([changesRequested], { headOid: 'c2' });
    const approvedInApp = makeUserState({ handledAt: at(20), approvedAt: at(15), approvedCommitOid: 'c2' });
    expect(changeRequestHoldsOpen(pushed, approvedInApp, viewer)).toBe(false);
    expect(isPrDone(pushed, approvedInApp, viewer, [changesEvent])).toBe(true);
  });

  it('ends when the review is dismissed', () => {
    const dismissed = { ...changesRequested, state: 'DISMISSED' as const };
    expect(changeRequestHoldsOpen(waitingPr([dismissed]), handled, viewer)).toBe(false);
    expect(isPrDone(waitingPr([dismissed]), handled, viewer, [changesEvent])).toBe(true);
  });

  it('ends when the PR is merged or closed', () => {
    for (const state of ['MERGED', 'CLOSED'] as const) {
      const pr = waitingPr([changesRequested], { state });
      expect(changeRequestHoldsOpen(pr, handled, viewer)).toBe(false);
      expect(isPrDone(pr, handled, viewer, [changesEvent])).toBe(true);
    }
  });

  it('never holds without a viewer', () => {
    expect(changeRequestHoldsOpen(waitingPr(), handled, null)).toBe(false);
  });
});

describe('reading a PR your change request holds open', () => {
  const pr = waitingPr();
  const comment = makeEvent({ id: 'acme/app#1:comment:c9', kind: 'comment', actor: 'bob', at: at(30), ruleLoudness: 'quiet' });
  const events = [changesEvent, comment];
  const afterRead = prAfterMarkRead({ pr, events, userState: null, viewer, notYours: false, tracked: true, readAt: at(100) });

  it('leaves nothing asked, not done, and the author\'s move', () => {
    expect(afterRead).toMatchObject({ done: false, nothingAsked: true });
    expect(afterRead.turn.kind).toBe('them');
  });

  it('labels the button Mark read, never Done for now', () => {
    const row = { provenance: { kind: 'pinged', reason: 'author' } as const, done: false, turn: afterRead.turn, afterRead, unseenLoudEvents: 0, unreadOnGitHub: true };
    expect(prMarkAction({ kind: 'unread' }, row)).toBe('mark_read');
  });

  it('still marks it read when you open it and it is the author\'s move', () => {
    const thread = makeThreadFor(pr, { unread: true, updatedAt: at(30), lastReadAt: at(10) });
    const check = openedReadCheck({ thread, prFetchedAt: at(40), pr, tiles: [{ snoozed: false }], nothingAskedAfterRead: afterRead.nothingAsked });
    expect(check).toEqual({ kind: 'mark' });
  });

  it('leaves it alone when the author addressed your changes: re-review is your move', () => {
    const push = makeEvent({ id: 'acme/app#1:push:c2', kind: 'commits_pushed', actor: 'alice', at: at(30), ruleLoudness: 'loud' });
    const addressed = waitingPr([changesRequested], { headOid: 'c2', commits: [makeCommit({ oid: 'c1', author: 'alice', committedAt: at(5) }), makeCommit({ oid: 'c2', author: 'alice', committedAt: at(30) })] });
    const after = prAfterMarkRead({ pr: addressed, events: [changesEvent, push], userState: null, viewer, notYours: false, tracked: true, readAt: at(100) });
    expect(after.nothingAsked).toBe(false);
    const thread = makeThreadFor(addressed, { unread: true, updatedAt: at(30), lastReadAt: at(10) });
    expect(openedReadCheck({ thread, prFetchedAt: at(40), pr: addressed, tiles: [{ snoozed: false }], nothingAskedAfterRead: after.nothingAsked })).toEqual({ kind: 'skip', why: 'asks_you' });
  });
});

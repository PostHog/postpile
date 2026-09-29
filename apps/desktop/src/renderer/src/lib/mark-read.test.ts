import { describe, expect, it } from 'vitest';
import type { PrSummary, TileAfterRead, TileStateKind, TileView, WhoseTurn } from '@postpile/core';
import { detailMarkLabel, detailPendingWrite, detailPr, detailPrimary, githubLink, markButtonLabel, markReadNotice, moveWords, prMarkAction, tileFooterAction, type DetailPrRow } from './mark-read.ts';

const NONE: WhoseTurn = { kind: 'none', who: null, what: '', prKey: null };
const REREVIEW: WhoseTurn = { kind: 'you', move: 're_review', who: null, what: 'pim addressed your changes: re-review', prKey: 'acme/app#1960' };

function view(kind: TileStateKind, turn: WhoseTurn, afterRead: TileAfterRead): Pick<TileView, 'state' | 'turn' | 'afterRead'> {
  return { state: { kind, unreadBecause: [] }, turn, afterRead };
}

const stillYours: TileAfterRead = { done: false, turn: REREVIEW };
const doneAfter: TileAfterRead = { done: true, turn: NONE };

describe('tileFooterAction and markButtonLabel', () => {
  it('says Mark read on an unread tile, whatever a mark-read leaves', () => {
    expect(tileFooterAction(view('unread', REREVIEW, stillYours))).toBe('mark_read');
    expect(markButtonLabel(view('unread', NONE, doneAfter))).toBe('Mark read');
  });

  it('never says Mark done on a read tile that is still your move: Snooze takes over', () => {
    expect(tileFooterAction(view('open', REREVIEW, stillYours))).toBe('snooze');
    expect(markButtonLabel(view('open', REREVIEW, stillYours))).toBeNull();
  });

  it('says Mark done only where a mark-read makes the tile done', () => {
    expect(tileFooterAction(view('open', NONE, doneAfter))).toBe('mark_done');
    expect(markButtonLabel(view('open', NONE, { done: false, turn: NONE }))).toBe('Mark read');
  });

  it('opens a done tile and offers no mark button', () => {
    expect(tileFooterAction(view('done', NONE, doneAfter))).toBe('open');
    expect(markButtonLabel(view('done', NONE, doneAfter))).toBeNull();
    expect(markButtonLabel(view('done', NONE, { done: false, turn: NONE }))).toBeNull();
  });

  it('keeps the mark button on a snoozed tile, with the honest label', () => {
    expect(markButtonLabel(view('snoozed', REREVIEW, stillYours))).toBe('Mark read');
    expect(markButtonLabel(view('snoozed', NONE, doneAfter))).toBe('Mark done');
  });
});

describe('detailPrimary', () => {
  it('leads with Open on GitHub on a done tile, with no mark label', () => {
    const done = view('done', NONE, doneAfter);
    expect(detailPrimary({ view: done, pr: null, prAction: 'open_on_github', approveVariant: 'primary' })).toBe('open_on_github');
    expect(detailMarkLabel(done, null)).toBeNull();
  });

  it('keeps Approve in the lead while it is due', () => {
    expect(detailPrimary({ view: view('unread', NONE, doneAfter), pr: null, prAction: 'approve', approveVariant: 'primary' })).toBe('approve');
  });

  it('leads with the tile action next to an outlined Approve again', () => {
    // Someone else's PR you approved, unread: the tile leads with Mark read, so does the pane.
    expect(detailPrimary({ view: view('unread', NONE, doneAfter), pr: null, prAction: 'approved', approveVariant: 'secondary' })).toBe('mark_read');
    expect(detailPrimary({ view: view('open', NONE, doneAfter), pr: null, prAction: 'approved', approveVariant: 'secondary' })).toBe('mark_done');
    expect(detailPrimary({ view: view('open', REREVIEW, stillYours), pr: null, prAction: 'approved', approveVariant: 'secondary' })).toBe('snooze');
  });

  it('leads with the tile action next to an outlined Approve draft', () => {
    expect(detailPrimary({ view: view('unread', NONE, doneAfter), pr: null, prAction: 'approve', approveVariant: 'secondary' })).toBe('mark_read');
  });

  it('follows the tile on your own PR too', () => {
    expect(detailPrimary({ view: view('open', REREVIEW, stillYours), pr: null, prAction: 'open_on_github', approveVariant: 'primary' })).toBe('snooze');
  });

  it('opens GitHub from a done tile, whose footer Open means nothing in the pane', () => {
    expect(detailPrimary({ view: view('done', NONE, doneAfter), pr: null, prAction: 'open_on_github', approveVariant: 'primary' })).toBe('open_on_github');
  });
});

function pr(overrides: Partial<PrSummary>): PrSummary {
  return {
    key: 'acme/app#1960',
    url: 'https://github.com/acme/app/pull/1960',
    authorRelation: 'other',
    provenance: { kind: 'pinged', reason: 'review_requested' },
    ...overrides,
  } as PrSummary;
}

function tileWith(prs: PrSummary[], turn: WhoseTurn): TileView {
  return { prs, turn } as TileView;
}

describe('the detail pane on a stack or set: acts on the selected PR', () => {
  const pinged = { kind: 'pinged', reason: 'subscribed' } as const;
  function row(overrides: Partial<DetailPrRow> = {}): DetailPrRow {
    return { provenance: pinged, done: false, turn: NONE, afterRead: doneAfter, unseenLoudEvents: 0, ...overrides };
  }
  const openSet = view('open', REREVIEW, stillYours);

  it('picks the selected PR on a stack or set, none on a single-PR tile', () => {
    const prs = [{ key: 'acme/app#1' }, { key: 'acme/app#2' }] as PrSummary[];
    const members = prs.map((pr) => ({ prKey: pr.key, provenance: pinged }));
    const tile = { id: 'set:s1', topicId: 't', kind: 'set' as const, title: 'Set', members, stacks: [] };
    expect(detailPr({ tile, prs }, 'acme/app#2')).toBe(prs[1]);
    expect(detailPr({ tile: { ...tile, kind: 'single', members: members.slice(0, 1) }, prs: prs.slice(0, 1) }, 'acme/app#1')).toBeNull();
  });

  it('says Mark done for a read PR a mark-read makes done, whatever the rest of the set asks', () => {
    // The tile is still your move on another PR; this PR asks nothing.
    expect(prMarkAction(openSet, row())).toBe('mark_done');
    expect(detailMarkLabel(openSet, row())).toBe('Mark done');
    expect(detailPrimary({ view: openSet, pr: row(), prAction: 'approved', approveVariant: 'secondary' })).toBe('mark_done');
  });

  it('says Mark read for a PR with news, and for one a mark-read leaves asking', () => {
    expect(detailMarkLabel(openSet, row({ unseenLoudEvents: 1, turn: REREVIEW }))).toBe('Mark read');
    expect(detailMarkLabel(openSet, row({ afterRead: { done: false, turn: NONE } }))).toBe('Mark read');
  });

  it('shows no mark button while that PR is still your move; Open on GitHub leads', () => {
    const yours = row({ turn: REREVIEW, afterRead: stillYours });
    expect(detailMarkLabel(openSet, yours)).toBeNull();
    expect(detailPrimary({ view: openSet, pr: yours, prAction: 'approved', approveVariant: 'secondary' })).toBe('open_on_github');
    // Never Snooze for one PR of a set: that lives in the tile footer.
    expect(detailPrimary({ view: openSet, pr: yours, prAction: 'open_on_github', approveVariant: 'primary' })).not.toBe('snooze');
  });

  it('has nothing to mark on a PR that is done, a quiet pulled-in layer or a done tile', () => {
    expect(detailMarkLabel(openSet, row({ done: true }))).toBeNull();
    expect(detailMarkLabel(openSet, row({ provenance: { kind: 'pulled_in', reason: 'stack layer' } }))).toBeNull();
    expect(detailMarkLabel(openSet, row({ provenance: { kind: 'pulled_in', reason: 'stack layer' }, unseenLoudEvents: 1 }))).toBe('Mark read');
    expect(detailMarkLabel(view('done', NONE, doneAfter), row())).toBeNull();
  });

  it('keeps Approve in the lead while it is due', () => {
    expect(detailPrimary({ view: openSet, pr: row(), prAction: 'approve', approveVariant: 'primary' })).toBe('approve');
  });

  it('waits only on the selected PR own pending write on a stack or set', () => {
    const pending = { since: '2026-09-29T10:00:00.000Z', error: null };
    // #1 of the set has a locked mark-read pending, so the tile has one too.
    expect(detailPendingWrite({ pendingWrite: pending }, { pendingWrite: null })).toBeNull();
    expect(detailPendingWrite({ pendingWrite: pending }, { pendingWrite: pending })).toBe(pending);
    expect(detailPendingWrite({ pendingWrite: pending }, null)).toBe(pending);
  });

  it('behaves as the tile on a single-PR tile', () => {
    expect(detailMarkLabel(openSet, null)).toBeNull();
    expect(detailMarkLabel(view('open', NONE, doneAfter), null)).toBe('Mark done');
  });
});

describe('githubLink', () => {
  it('opens the files tab of the PR the move is about', () => {
    const other = pr({ key: 'acme/app#12', url: 'https://github.com/acme/app/pull/12' });
    expect(githubLink(tileWith([other, pr({})], REREVIEW))).toEqual({
      label: 'Review on GitHub',
      href: 'https://github.com/acme/app/pull/1960/files',
    });
  });

  it('opens your own PR itself', () => {
    const own = pr({ authorRelation: 'you' });
    expect(githubLink(tileWith([own], REREVIEW))).toEqual({ label: 'Open on GitHub', href: own.url });
  });
});

describe('moveWords', () => {
  it('keeps just the move of an answer to your changes', () => {
    expect(moveWords('pim addressed your changes: re-review')).toBe('re-review');
    expect(moveWords('pim addressed your changes: re-review on #12')).toBe('re-review on #12');
  });

  it('lowers the first letter of other moves', () => {
    expect(moveWords('Review, rowan asked')).toBe('review, rowan asked');
  });
});

describe('markReadNotice', () => {
  const base = { message: 'marked 2 events read', ok: true, writesOn: true };

  it('says it is still your move and offers Snooze', () => {
    expect(markReadNotice({ ...base, afterRead: stillYours })).toEqual({
      message: 'Marked read. Still your move: re-review.',
      offerSnooze: true,
    });
  });

  it('keeps the engine message when the tile turns done', () => {
    expect(markReadNotice({ ...base, afterRead: doneAfter })).toEqual({ message: base.message, offerSnooze: false });
  });

  it('keeps the engine message while writes are locked or on failure', () => {
    expect(markReadNotice({ ...base, writesOn: false, afterRead: stillYours }).offerSnooze).toBe(false);
    expect(markReadNotice({ ...base, ok: false, afterRead: stillYours }).offerSnooze).toBe(false);
  });
});

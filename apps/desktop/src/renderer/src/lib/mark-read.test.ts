import { describe, expect, it } from 'vitest';
import type { PrSummary, TileAfterRead, TileStateKind, TileView, WhoseTurn } from '@postpile/core';
import { githubLink, markButtonLabel, markReadNotice, moveWords, tileFooterAction } from './mark-read.ts';

const NONE: WhoseTurn = { kind: 'none', who: null, what: '', prKey: null };
const REREVIEW: WhoseTurn = { kind: 'you', who: null, what: 'pim addressed your changes: re-review', prKey: 'acme/app#1960' };

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

  it('opens a done tile', () => {
    expect(tileFooterAction(view('done', NONE, doneAfter))).toBe('open');
  });

  it('keeps the mark button on a snoozed tile, with the honest label', () => {
    expect(markButtonLabel(view('snoozed', REREVIEW, stillYours))).toBe('Mark read');
    expect(markButtonLabel(view('snoozed', NONE, doneAfter))).toBe('Mark done');
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

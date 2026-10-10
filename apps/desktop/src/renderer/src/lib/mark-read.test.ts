import { describe, expect, it } from 'vitest';
import type { TileAfterRead, WhoseTurn } from '@postpile/core';
import { isMarkReadUndoToken, markReadNotice, moveWords, snoozeMessage } from './mark-read.ts';

const NONE: WhoseTurn = { kind: 'none', who: null, what: '', prKey: null };
const REREVIEW: WhoseTurn = { kind: 'you', move: 're_review', who: null, what: 'pim addressed your changes: re-review', prKey: 'acme/app#1960' };

const stillYours: TileAfterRead = { done: false, turn: REREVIEW };
const doneAfter: TileAfterRead = { done: true, turn: NONE };

describe('moveWords', () => {
  it('keeps just the move of an answer to your changes', () => {
    expect(moveWords('pim addressed your changes: re-review')).toBe('re-review');
    expect(moveWords('pim addressed your changes: re-review on #12')).toBe('re-review on #12');
  });

  it('lowers the first letter of other moves', () => {
    expect(moveWords('Review, rowan asked')).toBe('review, rowan asked');
  });
});

describe('snoozeMessage', () => {
  it('says the thread is still unread on GitHub when it is', () => {
    expect(snoozeMessage('Snoozed', true, true)).toBe('Snoozed. Still unread on GitHub.');
    expect(snoozeMessage('Snoozed.', true, true)).toBe('Snoozed. Still unread on GitHub.');
  });

  it('leaves GitHub out for a tile that was already read', () => {
    expect(snoozeMessage('Snoozed.', true, false)).toBe('Snoozed.');
  });

  it('keeps a failure as it is', () => {
    expect(snoozeMessage('Could not snooze', false, true)).toBe('Could not snooze');
  });
});

describe('markReadNotice', () => {
  it('names the PR marked from the pane and drops the mention that was just seen', () => {
    const mention: WhoseTurn = { kind: 'you', move: 'review', who: null, what: 'Review, lyra mentioned you', prKey: 'acme/app#1907' };
    expect(markReadNotice({ message: 'x', ok: true, writesOn: true, afterRead: { done: false, turn: mention }, prKey: 'acme/app#1907' }).message).toBe(
      'Marked #1907 read. Still your move: review.',
    );
  });

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

describe('isMarkReadUndoToken', () => {
  it('counts a mark-read token', () => {
    expect(isMarkReadUndoToken('a1b2c3')).toBe(true);
  });

  it('leaves out the tokens of local choices', () => {
    for (const token of ['memory:a1b2', 'memory:workctx:a1b2', 'proposal:a1b2', 'rule:a1b2', 'tailoring:a1b2']) {
      expect(isMarkReadUndoToken(token)).toBe(false);
    }
  });
});

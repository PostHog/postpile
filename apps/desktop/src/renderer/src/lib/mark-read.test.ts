import { describe, expect, it } from 'vitest';
import type { TileAfterRead, WhoseTurn } from '@postpile/core';
import { agentReadsToast, agentReadText, combinedUndoResult, isMarkReadUndoToken, markReadNotice, moveWords, snoozeMessage } from './mark-read.ts';

const NONE: WhoseTurn = { kind: 'none', who: null, what: '', prKey: null };
const REREVIEW: WhoseTurn = { kind: 'you', move: 're_review', who: null, what: 'pim addressed your changes: re-review', prKey: 'acme/app#1960' };

const stillYours: TileAfterRead = { done: false, nothingAsked: false, turn: REREVIEW };
const doneAfter: TileAfterRead = { done: true, nothingAsked: true, turn: NONE };

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
    expect(markReadNotice({ message: 'x', ok: true, writesOn: true, afterRead: { done: false, nothingAsked: false, turn: mention }, prKey: 'acme/app#1907' }).message).toBe(
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
  it("leaves out a scouted PR's Follow: it reaches GitHub, but it is no mark-read", () => {
    expect(isMarkReadUndoToken('follow:a1b2')).toBe(false);
  });
});

describe('agentReadText', () => {
  it('names the agent and the PRs it marked read', () => {
    expect(agentReadText({ client: 'claude-code', prKeys: ['acme/app#1902'], writesLocked: false })).toBe('Claude Code marked #1902 read');
    expect(agentReadText({ client: 'codex-mcp-client', prKeys: ['acme/app#1902', 'acme/app#1911', 'acme/app#1930'], writesLocked: false })).toBe('Codex marked #1902, #1911 and #1930 read');
  });

  it('says a locked mark-read waits for GitHub writes', () => {
    expect(agentReadText({ client: '', prKeys: ['acme/app#1902'], writesLocked: true })).toBe('an outside agent marked #1902 read: pending until you unlock GitHub writes, stays unread here until then');
  });
});

describe('agentReadsToast', () => {
  const NOW = Date.parse('2026-10-29T12:00:00Z');
  const notice = (id: number, prKey: string, undoUntil: string, undoable = true) => ({ id, at: '2026-10-29T11:59:55Z', undoable, client: 'claude-code', prKeys: [prKey], writesLocked: false, undoToken: `t${id}`, undoUntil });

  it('puts every new notice into one toast with an undo per batch, gone when the first window ends', () => {
    const toast = agentReadsToast([notice(1, 'acme/app#1', '2026-10-29T12:00:03Z'), notice(2, 'acme/app#2', '2026-10-29T12:00:05Z'), notice(3, 'acme/app#3', '2026-10-29T12:00:06Z')], 1, NOW);
    expect(toast).toEqual({
      message: 'Claude Code marked #2 read; Claude Code marked #3 read',
      // Each batch keeps its own window end, so the refetch after the later one sees it parked.
      batches: [
        { token: 't2', until: Date.parse('2026-10-29T12:00:05Z') },
        { token: 't3', until: Date.parse('2026-10-29T12:00:06Z') },
      ],
      undoUntil: Date.parse('2026-10-29T12:00:05Z'),
    });
  });

  it('still says what was marked once the undo window ended (a window minimised meanwhile), without Undo', () => {
    expect(agentReadsToast([notice(2, 'acme/app#2', '2026-10-29T11:59:59Z'), notice(3, 'acme/app#3', '2026-10-29T12:00:05Z', false)], 1, NOW)).toEqual({
      message: 'Claude Code marked #2 read; Claude Code marked #3 read',
      batches: [],
      undoUntil: null,
    });
  });

  it('shows nothing it showed before', () => {
    expect(agentReadsToast([notice(1, 'acme/app#1', '2026-10-29T12:00:05Z')], 1, NOW)).toBeNull();
  });
});

describe('combinedUndoResult', () => {
  it('reports the first failure of undos sent together, else the first answer', () => {
    const done = { ok: true, message: 'Undone', undoToken: null };
    const gone = { ok: false, message: 'Nothing to undo: already sent to GitHub', undoToken: null };
    expect(combinedUndoResult([done, gone, done])).toBe(gone);
    expect(combinedUndoResult([done, done])).toBe(done);
  });
});

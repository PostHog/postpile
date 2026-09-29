import { describe, expect, it } from 'vitest';
import type { TileStateKind, WhoseTurn } from '@postpile/core';
import { opensMarkRead, type OpenedTileView } from './opened-read.ts';

const NONE: WhoseTurn = { kind: 'none', who: null, what: '', prKey: null };
const ON = { enabled: true, forcedOffReason: null, pending: [] };
const OFF = { enabled: false, forcedOffReason: null, pending: [] };

function view(kind: TileStateKind, done: boolean): OpenedTileView {
  return { state: { kind, unreadBecause: [] }, afterRead: { done, turn: NONE }, prs: [{ key: 'acme/app#3' }] };
}

describe('opensMarkRead', () => {
  it('asks when a mark-read leaves the tile done and writes are unlocked', () => {
    expect(opensMarkRead(view('unread', true), 'acme/app#3', ON)).toBe(true);
    expect(opensMarkRead(view('open', true), 'acme/app#3', ON)).toBe(true);
  });

  it('never asks for a tile that stays your move or is snoozed', () => {
    expect(opensMarkRead(view('unread', false), 'acme/app#3', ON)).toBe(false);
    expect(opensMarkRead(view('snoozed', true), 'acme/app#3', ON)).toBe(false);
  });

  it('never asks while locked, before the writes state loaded, or for a PR the tile does not hold', () => {
    expect(opensMarkRead(view('unread', true), 'acme/app#3', OFF)).toBe(false);
    expect(opensMarkRead(view('unread', true), 'acme/app#3', undefined)).toBe(false);
    expect(opensMarkRead(view('unread', true), 'acme/app#9', ON)).toBe(false);
    expect(opensMarkRead(null, 'acme/app#3', ON)).toBe(false);
  });
});

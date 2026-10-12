import { describe, expect, it } from 'vitest';
import type { WhoseTurn } from '@postpile/core';
import { holdingPrLine, type HoldingTile } from './sections.ts';

const waitsOnTove: WhoseTurn = { kind: 'them', who: 'tove', what: 'to review', prKey: 'acme/app#1963' };
const nobody: WhoseTurn = { kind: 'none', who: null, what: '', prKey: null };

function tile(group: HoldingTile['group'], key: string, tier: HoldingTile['prs'][number]['tier'], turn: WhoseTurn = nobody): HoldingTile {
  return { group, prs: [{ key, tier, turn, provenance: { kind: 'pinged', reason: 'review_requested' } }] };
}

// Owner, 2026-10-11 (BOARD-A-14): name the PR that holds the topic in its section when it is folded away.
// Since 2026-10-12 Changes you requested never folds away; a read team mention or a not-yours review request still can.
describe('holdingPrLine', () => {
  it('names the PR in Dealt with that holds the topic in its ask section', () => {
    const tiles = [tile('dealt_with', 'acme/app#1857', 'rest'), tile('dealt_with', 'acme/app#1963', 'to_review', waitsOnTove)];
    expect(holdingPrLine(tiles, 'to_review')).toBe('In To review: #1963 waits on tove');
    expect(holdingPrLine([tile('dealt_with', 'acme/app#1963', 'team_mentioned')], 'team_mentioned')).toBe('In Team mentioned: #1963 is under Dealt with');
  });

  it('says nothing while a tile outside Dealt with shows the ask, or outside the ask sections', () => {
    const shown = [tile('open', 'acme/app#1964', 'changes_requested'), tile('dealt_with', 'acme/app#1963', 'changes_requested', waitsOnTove)];
    expect(holdingPrLine(shown, 'changes_requested')).toBeNull();
    expect(holdingPrLine([tile('dealt_with', 'acme/app#1963', 'mine')], 'you_drive')).toBeNull();
    expect(holdingPrLine([], 'to_review')).toBeNull();
  });
});

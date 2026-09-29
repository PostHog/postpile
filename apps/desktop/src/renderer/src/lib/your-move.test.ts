import { describe, expect, it } from 'vitest';
import { yourMoveChip } from './your-move.ts';

describe('yourMoveChip', () => {
  it('names the most urgent move and counts the rest', () => {
    const chip = yourMoveChip([
      { move: 'reply', text: "Answer lyra's question" },
      { move: 'review', text: 'Review, rowan asked' },
      { move: 'merge', text: 'Merge, it is approved' },
    ]);
    expect(chip).toEqual({ label: 'Reply +2', title: "Answer lyra's question · Review, rowan asked · Merge, it is approved" });
  });

  it('shows the word alone for one move', () => {
    expect(yourMoveChip([{ move: 're_review', text: 'pim addressed your changes: re-review' }])).toEqual({
      label: 'Re-review',
      title: 'pim addressed your changes: re-review',
    });
    expect(yourMoveChip([{ move: 'address_changes', text: "Address ada's changes" }])?.label).toBe('Address changes');
  });

  it('is null when nothing waits on you', () => {
    expect(yourMoveChip([])).toBeNull();
  });
});

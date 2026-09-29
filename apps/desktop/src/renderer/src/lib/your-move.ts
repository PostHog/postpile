import type { TopicMove, YourMove } from '@postpile/core';

/** The chip's word for each kind of move. */
const MOVE_LABELS: Record<YourMove, string> = {
  reply: 'Reply',
  re_review: 'Re-review',
  review: 'Review',
  address_changes: 'Address changes',
  fix_ci: 'Fix CI',
  merge: 'Merge',
};

export interface YourMoveChip {
  /** The most urgent move, plus how many more: "Reply +2". */
  label: string;
  /** Every move's words, "Answer lyra's question · Review, rowan asked". */
  title: string;
}

/** The topic row's "your move" chip; null when nothing waits on the user. `moves` come most urgent first. */
export function yourMoveChip(moves: TopicMove[]): YourMoveChip | null {
  const first = moves[0];
  if (first === undefined) {
    return null;
  }
  const more = moves.length - 1;
  const label = more > 0 ? `${MOVE_LABELS[first.move]} +${more}` : MOVE_LABELS[first.move];
  return { label, title: moves.map((move) => move.text).join(' · ') };
}

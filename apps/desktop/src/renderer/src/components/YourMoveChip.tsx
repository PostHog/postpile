import type { TopicMove } from '@postpile/core';
import { yourMoveChip } from '../lib/your-move.ts';

/**
 * The honey "your move" chip: the sidebar row and the topic header draw it
 * the same way. Nothing when no move waits on the user. `moves` come from
 * core, most urgent first.
 */
export function YourMoveChip(props: { moves: TopicMove[] }) {
  const chip = yourMoveChip(props.moves);
  if (chip === null) {
    return null;
  }
  return (
    <span
      title={chip.title}
      className="flex h-[15px] shrink-0 items-center rounded bg-honey-soft px-[5px] text-[9.5px] font-semibold whitespace-nowrap text-honey-ink inset-ring inset-ring-honey-ink/10"
    >
      {chip.label}
    </span>
  );
}

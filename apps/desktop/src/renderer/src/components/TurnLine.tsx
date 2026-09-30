import type { WhoseTurn } from '@postpile/core';
import { turnTitle } from '../lib/why.ts';
import { Avatar } from './Avatar.tsx';

/**
 * Whose turn, as one line: "Your move" plus the move, or the person it waits
 * on ("sol to merge", on your own PR "Waiting on sol"). Renders nothing when
 * it is nobody's turn.
 */
export function TurnLine(props: { turn: WhoseTurn; greyed?: boolean }) {
  const { turn } = props;
  if (turn.kind === 'you') {
    return (
      <span title={turnTitle(turn)} className={`flex min-w-0 items-center gap-[7px] text-xs ${props.greyed ? 'text-muted' : 'text-ink-2'}`}>
        <span className={`flex min-w-0 items-center gap-1.5 font-[650] ${props.greyed ? 'text-muted' : 'text-honey-ink'}`}>
          <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${props.greyed ? 'bg-ghost' : 'bg-honey ring-2 ring-honey/22'}`} />
          <span className="truncate">Your move</span>
        </span>
        {/* The move goes first when space runs out, then the label, down to the dot. */}
        <span className="min-w-0 shrink-[100] truncate">{turn.what}</span>
      </span>
    );
  }
  if (turn.kind === 'them' && turn.who) {
    return (
      <span title={turnTitle(turn)} className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted">
        <Avatar login={turn.who} />
        <span className="truncate">
          {turn.lead && `${turn.lead} `}
          <span className="font-[650]">{turn.who}</span>
          {turn.what && ` ${turn.what}`}
        </span>
      </span>
    );
  }
  return null;
}

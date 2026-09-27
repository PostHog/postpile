import type { WhoseTurn } from '@code-manager/core';
import { turnTitle } from '../lib/why.ts';
import { Avatar } from './Avatar.tsx';

/**
 * Whose turn, as one line: "Your move" plus the move, or the person it waits
 * on ("sol to merge"). Renders nothing when it is nobody's turn.
 */
export function TurnLine(props: { turn: WhoseTurn; greyed?: boolean }) {
  const { turn } = props;
  if (turn.kind === 'you') {
    return (
      <span title={turnTitle(turn)} className={`flex min-w-0 items-center gap-1.5 text-xs ${props.greyed ? 'text-muted' : 'text-ink-2'}`}>
        <span className={`shrink-0 font-bold ${props.greyed ? 'text-muted' : 'text-honey-ink'}`}>Your move</span>
        <span className="truncate">{turn.what}</span>
      </span>
    );
  }
  if (turn.kind === 'them' && turn.who) {
    return (
      <span title={turnTitle(turn)} className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted">
        <Avatar login={turn.who} />
        <span className="truncate">
          <span className="font-[650]">{turn.who}</span> {turn.what}
        </span>
      </span>
    );
  }
  return null;
}

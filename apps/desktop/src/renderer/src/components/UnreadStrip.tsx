import type { TileView } from '@code-manager/core';
import { ageLabel } from '../lib/time.ts';
import { newestUnreadReason, prNumber } from '../lib/tiles.ts';
import { useNow } from '../lib/use-now.ts';
import { MentionIcon } from './icons.tsx';

/** The coral strip on unread tiles: which event on which PR made it unread, and when. */
export function UnreadStrip(props: { view: TileView }) {
  const now = useNow();
  const reason = newestUnreadReason(props.view);
  if (!reason) {
    return null;
  }
  const more = props.view.state.unreadBecause.length - 1;
  return (
    <div className="flex h-[30px] shrink-0 items-center gap-2 rounded-t-[11px] border-b border-unread-strip bg-unread-soft px-3.5 text-xs text-unread-ink">
      <span className="text-unread">
        <MentionIcon />
      </span>
      <span className="truncate font-semibold">{reason.summary}</span>
      {props.view.prs.length > 1 && <span className="shrink-0 font-mono text-[10.5px]">#{prNumber(reason.prKey)}</span>}
      {more > 0 && <span className="shrink-0 text-unread-when">+{more} more</span>}
      <span className="ml-auto shrink-0 font-mono text-[10.5px] text-unread-when">{ageLabel(reason.at, now)}</span>
    </div>
  );
}

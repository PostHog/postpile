import type { TileView } from '@postpile/core';
import { eventGlyph, splitActor } from '../lib/events.ts';
import { ageLabel } from '../lib/time.ts';
import { isFyiNews, newestUnreadReason, prNumber } from '../lib/tiles.ts';
import { useNow } from '../lib/use-now.ts';
import { Avatar } from './Avatar.tsx';
import { Glyph } from './icons.tsx';

/**
 * "Why now" on unread tiles: who did what, with an ink event badge on their
 * avatar, a coral dot for new since you looked, and how long ago.
 */
export function UnreadStrip(props: { view: TileView }) {
  const now = useNow();
  const reason = newestUnreadReason(props.view);
  if (!reason) {
    return null;
  }
  const more = props.view.state.unreadBecause.length - 1;
  const split = splitActor(reason.summary, reason.actor);
  return (
    <div className="flex h-[38px] shrink-0 items-center gap-[9px] rounded-t-[11px] border-b border-warm-strip-line bg-warm-strip px-3.5 text-xs text-ink">
      <span className="relative shrink-0">
        <Avatar login={reason.actor} size="lg" />
        <span className="absolute -right-1 -bottom-[3px] flex size-[15px] items-center justify-center rounded-full border-[1.5px] border-warm-strip bg-ink text-on-ink">
          <Glyph glyph={eventGlyph(reason.kind)} />
        </span>
      </span>
      <span className="min-w-0 truncate" title={reason.summary}>
        {split ? (
          <>
            <span className="font-[650]">{split.actor}</span>
            {split.rest}
          </>
        ) : (
          reason.summary
        )}
      </span>
      {isFyiNews(props.view) && (
        <span className="shrink-0 text-[11px] text-muted" title="News on your own PR; nothing in it asks you to act">
          · FYI, nothing to do
        </span>
      )}
      {props.view.prs.length > 1 && <span className="shrink-0 font-mono text-[10.5px] text-muted">#{prNumber(reason.prKey)}</span>}
      {more > 0 && (
        <span className="shrink-0 text-[11px] text-muted" title={`${more} more unread on this tile`}>
          +{more}
        </span>
      )}
      <span aria-label="New since you looked" className="ml-auto size-[7px] shrink-0 rounded-full bg-unread" />
      <span className="shrink-0 font-mono text-[10.5px] text-faint">{ageLabel(reason.at, now)}</span>
    </div>
  );
}

import type { TileView } from '@postpile/core';
import { eventGlyph, splitActor } from '../lib/events.ts';
import { ageLabel } from '../lib/time.ts';
import { isFyiNews, newestUnreadReason, prNumber, stripMoreCount, stripNews } from '../lib/tiles.ts';
import { useNow } from '../lib/use-now.ts';
import { whatsNewText } from '../lib/whats-new.ts';
import { Avatar } from './Avatar.tsx';
import { Glyph } from './icons.tsx';

/**
 * "Why now" on unread tiles: who did what, with an ink event badge on their
 * avatar, a coral NEW pill when core says so (`TileView.newBadge`: never on a
 * quiet automation headline), and how long ago. On a
 * revisit (the viewer touched the PR before) the text says what changed
 * since that touch instead ("6 commits since your changes request").
 */
export function UnreadStrip(props: { view: TileView }) {
  const now = useNow();
  const reason = newestUnreadReason(props.view);
  if (!reason) {
    return null;
  }
  const news = stripNews(props.view);
  const more = stripMoreCount(props.view, news);
  const actor = news ? news.actor : reason.actor;
  const text = news ? whatsNewText(news) : reason.summary;
  const split = splitActor(text, actor);
  return (
    <div className="flex h-[38px] shrink-0 items-center gap-[9px] rounded-t-tile border-b border-warm-strip-line bg-warm-strip pr-3.5 pl-[15px] text-xs text-ink">
      <span className="relative shrink-0">
        <Avatar login={actor} size="lg" />
        <span className="absolute -right-1 -bottom-[3px] flex size-[15px] items-center justify-center rounded-full border-[1.5px] border-warm-strip bg-ink text-on-ink">
          <Glyph glyph={eventGlyph(news ? news.lead.eventKind : reason.kind)} />
        </span>
      </span>
      <span className="min-w-0 truncate" title={news ? `${text} · newest: ${reason.summary}` : reason.summary}>
        {split ? (
          <>
            <span className="font-[650]">{split.actor}</span>
            {split.rest}
          </>
        ) : (
          text
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
      {props.view.newBadge && (
        <span
          aria-label="New since you looked"
          className="ml-auto flex h-4 shrink-0 items-center rounded-full bg-unread px-1.5 text-[9.5px] font-bold tracking-[0.04em] text-on-ink"
        >
          NEW
        </span>
      )}
      <span className={`shrink-0 font-mono text-[10.5px] text-faint${props.view.newBadge ? '' : ' ml-auto'}`}>{ageLabel(news ? news.newestAt : reason.at, now)}</span>
    </div>
  );
}

/**
 * The quiet counterpart on an open tile: a merge without the user's review
 * they have not seen. Grey, no NEW badge, never coral: it waits to be looked
 * at, it does not ask for anything (DESIGN "Merged without your review").
 */
export function UnseenMergeStrip(props: { view: TileView }) {
  const now = useNow();
  const merges = props.view.state.unseenMerges ?? [];
  const merge = merges[merges.length - 1];
  if (!merge) {
    return null;
  }
  const split = splitActor(merge.summary, merge.actor);
  return (
    <div className="flex h-[38px] shrink-0 items-center gap-[9px] rounded-t-tile border-b border-hairline bg-subtle pr-3.5 pl-[15px] text-xs text-ink-2">
      <span className="relative shrink-0">
        <Avatar login={merge.actor} size="lg" />
        <span className="absolute -right-1 -bottom-[3px] flex size-[15px] items-center justify-center rounded-full border-[1.5px] border-subtle bg-ink-2 text-on-ink">
          <Glyph glyph={eventGlyph(merge.kind)} />
        </span>
      </span>
      <span className="min-w-0 truncate" title={`${merge.summary}. Not seen yet; Done for now once you have looked.`}>
        {split ? (
          <>
            <span className="font-[650]">{split.actor}</span>
            {split.rest}
          </>
        ) : (
          merge.summary
        )}
      </span>
      {props.view.prs.length > 1 && <span className="shrink-0 font-mono text-[10.5px] text-muted">#{prNumber(merge.prKey)}</span>}
      {merges.length > 1 && (
        <span className="shrink-0 text-[11px] text-muted" title={`${merges.length - 1} more merged without your review on this tile`}>
          +{merges.length - 1}
        </span>
      )}
      <span className="ml-auto shrink-0 font-mono text-[10.5px] text-faint">{ageLabel(merge.at, now)}</span>
    </div>
  );
}

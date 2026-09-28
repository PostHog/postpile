import { useState } from 'react';
import type { NotificationDebugRow } from '@code-manager/core';
import { landingLabel, noTileReason, threadRef } from '../lib/notifications.ts';
import { ageLabel } from '../lib/time.ts';
import { useNow } from '../lib/use-now.ts';
import { ChevronIcon } from './icons.tsx';

export interface TilePick {
  topicId: string;
  tileId: string;
  prKey: string | null;
}

/** The PR's newest stored events, under an expanded row. */
function RecentEvents(props: { row: NotificationDebugRow }) {
  const now = useNow();
  if (props.row.recentEvents.length === 0) {
    return <p className="text-[11.5px] text-faint">{props.row.prKey ? 'No stored events for this PR.' : 'Not a PR, so no events.'}</p>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {props.row.recentEvents.map((event) => (
        <li key={event.id} className="grid grid-cols-[34px_110px_52px_minmax(0,1fr)] items-baseline gap-2 text-[11.5px]">
          <span className="font-mono text-[10.5px] text-faint">{ageLabel(event.at, now)}</span>
          <span className="truncate font-mono text-[10.5px] text-muted">{event.kind}</span>
          <span className={`font-mono text-[10px] ${event.loudness === 'loud' && !event.seen ? 'text-unread-ink' : 'text-faint'}`}>
            {event.seen ? 'seen' : event.loudness}
          </span>
          <span className="truncate text-ink-2 select-text" title={event.summary}>
            {event.summary}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * One stored notification thread. A click jumps to its tile (never marks
 * anything read); without a tile it says why inline. The chevron shows the
 * PR's newest logged events.
 */
export function NotificationRow(props: { row: NotificationDebugRow; onOpenTile: (pick: TilePick) => void }) {
  const now = useNow();
  const [expanded, setExpanded] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const { row } = props;
  const { thread, landing } = row;
  const why = noTileReason(landing);

  function open() {
    if (landing.kind === 'tile') {
      props.onOpenTile({ topicId: landing.topicId, tileId: landing.tileId, prKey: row.prKey });
    } else {
      setShowWhy(!showWhy);
    }
  }

  return (
    <li className="flex flex-col border-t border-hairline-soft first:border-t-0">
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={open}
          title={landing.kind === 'tile' ? 'Open this tile. Nothing is marked read.' : 'Why is there no tile?'}
          className="grid min-w-0 flex-1 grid-cols-[52px_minmax(0,1fr)_128px_minmax(0,0.8fr)_36px] items-center gap-3 px-3 py-2 text-left hover:bg-subtle"
        >
          <span>
            {thread.unread ? (
              <span className="rounded bg-unread-soft px-1 font-mono text-[9.5px] font-semibold text-unread-ink">unread</span>
            ) : (
              <span className="font-mono text-[9.5px] text-faint">read</span>
            )}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="flex items-baseline gap-1.5">
              <span className="shrink-0 font-mono text-[10.5px] text-muted">{threadRef(row)}</span>
              <span className="shrink-0 text-[10.5px] text-faint">{thread.subjectType}</span>
            </span>
            <span className="truncate text-[12.5px] text-ink" title={thread.title}>
              {thread.title}
            </span>
          </span>
          <span className="truncate font-mono text-[10.5px] text-ink-2">{thread.reason}</span>
          <span className={`truncate text-[11.5px] ${landing.kind === 'tile' ? 'text-accent' : 'text-muted'}`} title={landingLabel(landing)}>
            {landingLabel(landing)}
            {landing.kind === 'tile' && <span className="text-faint"> · {landing.tileState}</span>}
          </span>
          <span className="text-right font-mono text-[10.5px] text-faint" title={thread.updatedAt}>
            {ageLabel(thread.updatedAt, now)}
          </span>
        </button>
        <button
          type="button"
          aria-expanded={expanded}
          aria-label="Recent events of this PR"
          title="Recent events of this PR"
          onClick={() => setExpanded(!expanded)}
          className="flex w-8 shrink-0 items-center justify-center text-faint hover:bg-subtle hover:text-ink"
        >
          <span className={expanded ? '' : '-rotate-90'}>
            <ChevronIcon />
          </span>
        </button>
      </div>
      {showWhy && why && <p className="mx-3 mb-2 rounded-row bg-subtle px-3 py-2 text-[11.5px] text-ink-2">{why}</p>}
      {expanded && (
        <div className="mx-3 mb-2 rounded-row border border-hairline-soft px-3 py-2">
          <RecentEvents row={row} />
        </div>
      )}
    </li>
  );
}

import { useState } from 'react';
import type { GitHubWritesStatus, NotificationDebugRow } from '@code-manager/core';
import { useActions } from '../api/actions.tsx';
import { actionLine, landingLabel, noTileReason, threadRef, type ActionTone } from '../lib/notifications.ts';
import { ageLabel } from '../lib/time.ts';
import { useNow } from '../lib/use-now.ts';
import { ChevronIcon } from './icons.tsx';

export interface TilePick {
  topicId: string;
  tileId: string;
  prKey: string | null;
}

const TONE: Record<ActionTone, string> = {
  app: 'text-accent',
  local: 'text-ink-2',
  problem: 'text-unread-ink',
  outside: 'text-faint',
};

const BRING_BACK_TITLE =
  'GitHub has no API to mark a notification unread. This only resets the app: the tile turns unread again ("brought back by you") until you mark it read. Nothing changes on GitHub.';

/** Hover text for "Mark read", or why it is disabled. */
function markReadTitle(row: NotificationDebugRow, writes: GitHubWritesStatus | undefined): { title: string; disabled: boolean } {
  const hasPr = row.landing.kind !== 'not_pr' && row.landing.kind !== 'pr_not_synced';
  if (!writes) {
    return { title: 'Waiting for the GitHub writes state.', disabled: true };
  }
  if (!row.thread.unread) {
    return { title: 'Already read on GitHub.', disabled: true };
  }
  if (!writes.enabled && !hasPr) {
    return { title: 'GitHub writes are off and this thread has no tile, so there is nothing to mark.', disabled: true };
  }
  if (!writes.enabled) {
    return { title: 'GitHub writes are off: marks the PR read in the app only; the thread stays unread on GitHub. Logged.', disabled: false };
  }
  return { title: 'Marks the thread read on GitHub after the 6s undo window (and its PR read here). Logged.', disabled: false };
}

/** Mark read (through the queue, lock and log) and bring back (app state only). */
function RowActions(props: { row: NotificationDebugRow }) {
  const actions = useActions();
  const { row } = props;
  const markRead = markReadTitle(row, actions.writes);
  const canBringBack = row.prKey !== null && row.landing.kind !== 'pr_not_synced';
  const button = 'rounded px-1.5 py-0.5 text-[11px] text-ink-2 hover:bg-subtle hover:text-ink disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent';
  return (
    <div className="flex w-[142px] shrink-0 items-center justify-end gap-0.5 pr-1">
      <button
        type="button"
        className={button}
        disabled={markRead.disabled || actions.isBusy(`markThread:${row.thread.id}`)}
        title={markRead.title}
        onClick={() => void actions.markThreadRead(row.thread.id)}
      >
        Mark read
      </button>
      <button
        type="button"
        className={button}
        disabled={!canBringBack || actions.isBusy(`bringBack:${row.prKey ?? ''}`)}
        title={canBringBack ? BRING_BACK_TITLE : 'Only a synced PR has a tile to bring back.'}
        onClick={() => row.prKey && void actions.bringBack(row.prKey)}
      >
        Bring back
      </button>
    </div>
  );
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
  const line = actionLine(row, now);

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
            {line && (
              <span className={`truncate text-[11px] ${TONE[line.tone]}`} title={line.title}>
                {line.text}
              </span>
            )}
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
        <RowActions row={row} />
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

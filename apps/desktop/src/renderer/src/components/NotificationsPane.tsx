import { useState } from 'react';
import type { NotificationReason } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { useDebugNotifications } from '../api/debug.ts';
import { syncReportDetail } from '../lib/sync-report.ts';
import { filterNotifications, NO_NOTIFICATION_FILTER, reasonsIn, type NotificationFilter } from '../lib/notifications.ts';
import { NotificationRow, type TilePick } from './NotificationRow.tsx';

/** Rows asked from the server; plenty for a debug look at the stream. */
const LIMIT = 300;

const CONTROL = 'h-7 rounded-control border border-control bg-surface px-2 text-[12px] text-ink shadow-control outline-none focus:border-accent-line';

/**
 * Debug pane: the stored GitHub notification threads, newest first, as
 * GitHub sent them, with where each landed in the app and the app's last
 * logged action on it. Opening a row never marks anything read; the row's
 * "Mark read" button is the only action here.
 */
/** The stored last sync report, errors included, as plain lines. */
function LastSyncBlock() {
  const report = useActions().lastSync;
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="text-[13px] font-semibold">Last sync</h2>
      {report ? (
        <pre className={`rounded-tile border border-hairline bg-surface px-3 py-2 font-mono text-[11px] whitespace-pre-wrap ${report.errors.length > 0 ? 'text-unread-ink' : 'text-ink-2'}`}>
          {syncReportDetail(report)}
        </pre>
      ) : (
        <p className="text-xs text-muted">No sync stored yet.</p>
      )}
    </section>
  );
}

export function NotificationsPane(props: { onOpenTile: (pick: TilePick) => void }) {
  const notifications = useDebugNotifications(LIMIT);
  const [filter, setFilter] = useState<NotificationFilter>(NO_NOTIFICATION_FILTER);
  const rows = notifications.data ?? [];
  const shown = filterNotifications(rows, filter);
  return (
    <main className="col-span-2 flex min-w-0 flex-col gap-[18px] overflow-auto px-[26px] py-[22px]">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[23px] leading-tight font-[650] tracking-[-0.022em]">Notifications</h1>
        <p className="max-w-[720px] text-[13px] text-ink-2">
          The raw GitHub notification threads as the last sync stored them, where each one landed, what the app last did to it (PostPile's own quiet
          mark-reads included), and the live poll's newest ping decision: pinged or withheld, by the rules or the agent, and why. A click opens its
          tile; the chevron shows recent events and the last ping decisions. "Mark read" goes through the same queue, undo and footer lock as a tile. GitHub has no mark-unread, so nothing brings a read thread back.
        </p>
      </div>
      <LastSyncBlock />
      <div className="flex flex-wrap items-center gap-2.5">
        <select
          aria-label="Reason"
          value={filter.reason ?? ''}
          onChange={(event) => setFilter({ ...filter, reason: event.target.value === '' ? null : (event.target.value as NotificationReason) })}
          className={CONTROL}
        >
          <option value="">Every reason</option>
          {reasonsIn(rows).map((reason) => (
            <option key={reason} value={reason}>
              {reason}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-[12px] text-ink-2">
          <input type="checkbox" checked={filter.unreadOnly} onChange={(event) => setFilter({ ...filter, unreadOnly: event.target.checked })} />
          Unread on GitHub only
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-ink-2" title="Threads whose newest logged action is the app's own mark-read: sent to GitHub, or queued to be">
          <input type="checkbox" checked={filter.readByApp} onChange={(event) => setFilter({ ...filter, readByApp: event.target.checked })} />
          Read by this app
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-ink-2" title="Threads with a mark-read made while GitHub writes were locked, waiting to be sent or discarded from the footer lock">
          <input type="checkbox" checked={filter.pendingOnly} onChange={(event) => setFilter({ ...filter, pendingOnly: event.target.checked })} />
          Pending while locked
        </label>
        <input
          type="search"
          aria-label="Filter notifications"
          placeholder="repo#number, title, topic"
          value={filter.text}
          onChange={(event) => setFilter({ ...filter, text: event.target.value })}
          spellCheck={false}
          className={`${CONTROL} w-64 placeholder:text-faint`}
        />
        <span className="ml-auto font-mono text-[10.5px] text-faint">
          {shown.length} of {rows.length}
          {rows.length === LIMIT && ` · newest ${LIMIT}`}
        </span>
      </div>
      {notifications.error && <p className="text-xs text-unread-ink">Could not load notifications: {notifications.error.message}</p>}
      {notifications.isPending && <p className="text-xs text-muted">Loading…</p>}
      {!notifications.isPending && rows.length === 0 && !notifications.error && (
        <p className="rounded-tile border border-dashed border-frame px-4 py-8 text-center text-xs text-muted">No notification threads stored yet. Sync pulls them in.</p>
      )}
      {rows.length > 0 && shown.length === 0 && <p className="text-xs text-muted">No thread matches the filters.</p>}
      {shown.length > 0 && (
        <ul className="flex shrink-0 flex-col overflow-hidden rounded-tile border border-hairline bg-surface shadow-tile">
          <li
            aria-hidden="true"
            className="grid grid-cols-[52px_minmax(0,1fr)_128px_minmax(0,0.8fr)_36px] gap-3 border-b border-hairline bg-subtle py-1.5 pr-[186px] pl-3 text-[10.5px] font-medium text-faint"
          >
            <span>GitHub</span>
            <span>Thread</span>
            <span>Reason</span>
            <span>Landed in</span>
            <span className="text-right">Updated</span>
          </li>
          {shown.map((row) => (
            <NotificationRow key={row.thread.id} row={row} onOpenTile={props.onOpenTile} />
          ))}
        </ul>
      )}
    </main>
  );
}

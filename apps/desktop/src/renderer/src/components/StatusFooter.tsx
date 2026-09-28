import type { LivePollStatus, TopicDetail, TopicListItem } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { callStatsLabel } from '../lib/agent-stats.ts';
import { liveLabel } from '../lib/live.ts';
import { syncReportDetail } from '../lib/sync-report.ts';
import { useNow } from '../lib/use-now.ts';
import { countPrs } from '../lib/tiles.ts';
import { WritesLock } from './WritesLock.tsx';

/** 26px strip: unread count, PR counts for the open topic, the GitHub writes lock, live poll, agent calls of the last sync, mark-read queue, app version. */
export function StatusFooter(props: { topics: TopicListItem[]; detail: TopicDetail | undefined; live: LivePollStatus | undefined }) {
  const actions = useActions();
  const now = useNow(1000);
  const live = liveLabel(props.live, now);
  const unread = props.topics.reduce((sum, item) => sum + item.unreadTiles, 0);
  const counts = props.detail ? countPrs(props.detail.tiles) : null;
  return (
    <footer className="flex h-[26px] shrink-0 items-center gap-4 border-t border-hairline-strong bg-titlebar px-3.5 font-mono text-[10.5px] text-muted">
      <span className="flex items-center gap-1.5">
        <span className={`size-1.5 rounded-full ${unread > 0 ? 'bg-unread' : 'bg-dot-quiet'}`} />
        {unread} unread
      </span>
      {counts && (
        <span>
          {counts.pinged} pinged{counts.found > 0 ? ` · ${counts.found} found` : ''} · {counts.pulledIn} pulled in
        </span>
      )}
      <WritesLock />
      <button
        type="button"
        onClick={() => void actions.sendTestNotification()}
        disabled={!window.postpile?.sendTestNotification}
        title={window.postpile?.sendTestNotification ? 'Send a test Mac notification' : 'Only in the desktop app'}
        className="text-muted hover:text-ink disabled:opacity-50 disabled:hover:text-muted"
      >
        test ping
      </button>
      <span className={live.warn ? 'text-closer' : ''} title={live.title}>
        {live.text}
      </span>
      {actions.lastSync && (
        <span title={syncReportDetail(actions.lastSync)} className={actions.lastSync.errors.length > 0 ? 'text-unread-ink' : ''}>
          last sync: {callStatsLabel(actions.lastSync.agentCallStats)}
          {actions.lastSync.errors.length > 0 && ` · ${actions.lastSync.errors.length} ${actions.lastSync.errors.length === 1 ? 'error' : 'errors'}`}
        </span>
      )}
      <span className="ml-auto">
        {actions.pendingMarkReads > 0 ? `${actions.pendingMarkReads} mark-read in the undo window` : 'mark-read queue empty'}
      </span>
      {window.postpile?.version && <span title="PostPile › About PostPile">v{window.postpile.version}</span>}
    </footer>
  );
}

import type { LivePollStatus, TopicDetail, TopicListItem } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { callStatsDetail, callStatsLabel } from '../lib/agent-stats.ts';
import { liveLabel } from '../lib/live.ts';
import { useNow } from '../lib/use-now.ts';
import { countPrs } from '../lib/tiles.ts';
import { WritesLock } from './WritesLock.tsx';

/** 26px strip: unread count, PR counts for the open topic, the GitHub writes lock, live poll, agent calls of the last sync, mark-read queue. */
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
          {counts.pinged} pinged · {counts.pulledIn} pulled in
        </span>
      )}
      <WritesLock />
      <span className={live.warn ? 'text-closer' : ''} title={live.title}>
        {live.text}
      </span>
      {actions.lastSync && (
        <span title={callStatsDetail(actions.lastSync.agentCallStats) || 'No agent calls in the last sync'}>
          last sync: {callStatsLabel(actions.lastSync.agentCallStats)}
        </span>
      )}
      <span className="ml-auto">
        {actions.pendingMarkReads > 0 ? `${actions.pendingMarkReads} mark-read pending · undo open` : 'mark-read queue empty'}
      </span>
    </footer>
  );
}

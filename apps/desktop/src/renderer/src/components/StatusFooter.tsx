import type { LivePollStatus, TopicDetail, TopicListItem } from '@code-manager/core';
import { useActions } from '../api/actions.tsx';
import { callStatsDetail, callStatsLabel } from '../lib/agent-stats.ts';
import { liveLabel } from '../lib/live.ts';
import { useNow } from '../lib/use-now.ts';
import { countPrs } from '../lib/tiles.ts';
import { LockIcon } from './icons.tsx';

function writesLabel(fake: boolean | undefined, writesAllowed: boolean | undefined): string {
  if (fake === undefined) {
    return 'loading config';
  }
  if (fake) {
    return 'sample data · actions stay local';
  }
  return writesAllowed ? 'GitHub writes on' : 'GitHub writes blocked';
}

/** 26px strip: unread count, PR counts for the open topic, write mode, live poll, agent calls of the last sync, mark-read queue. */
export function StatusFooter(props: { topics: TopicListItem[]; detail: TopicDetail | undefined; live: LivePollStatus | undefined }) {
  const actions = useActions();
  const now = useNow(1000);
  const live = liveLabel(props.live, now);
  const unread = props.topics.reduce((sum, item) => sum + item.unreadTiles, 0);
  const counts = props.detail ? countPrs(props.detail.tiles) : null;
  const blocked = actions.config !== undefined && !actions.config.writesAllowed;
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
      <span
        className={`flex items-center gap-1 ${blocked ? 'text-closer' : ''}`}
        title={blocked ? 'Start the app with CODE_MANAGER_ALLOW_WRITES=1 to approve, comment and mark read on GitHub' : undefined}
      >
        {blocked && <LockIcon />}
        {writesLabel(actions.config?.fake, actions.config?.writesAllowed)}
      </span>
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

import type { ReactNode } from 'react';
import type { LivePollStatus, TopicDetail, TopicListItem } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { useMcpConnection } from '../api/mcp.ts';
import { useTools } from '../api/tools.ts';
import { callStatsWords } from '../lib/agent-stats.ts';
import { liveLabel, quotaLabel } from '../lib/live.ts';
import { mcpFooterShows } from '../lib/mcp.ts';
import { syncReportDetail } from '../lib/sync-report.ts';
import { useNow } from '../lib/use-now.ts';
import { countPrs } from '../lib/tiles.ts';
import { toolsFooter } from '../lib/tools.ts';
import { McpFooterItem } from './McpFooterItem.tsx';
import { WritesLock } from './WritesLock.tsx';

/** Numbers in the footer are ink and semibold; the words around them stay muted. */
function Num(props: { children: ReactNode }) {
  return <span className="font-semibold text-ink-2">{props.children}</span>;
}

/** A 1×10px hairline between footer groups. */
function Divider() {
  return <span aria-hidden="true" className="h-2.5 w-px shrink-0 bg-control" />;
}

/** The items in order with a divider between each two that show. */
function withDividers(items: ReactNode[]): ReactNode[] {
  const shown = items.filter((item) => item !== null && item !== false && item !== undefined);
  return shown.flatMap((item, index) => (index === 0 ? [item] : [<Divider key={`divider-${index}`} />, item]));
}

/** 26px strip: unread count, PR counts for the open topic, the GitHub writes lock, live poll, the GitHub quota while low, what gh or claude leave off, agent calls of the last sync, the MCP offer while not connected, mark-read queue, app version. */
export function StatusFooter(props: { topics: TopicListItem[]; detail: TopicDetail | undefined; live: LivePollStatus | undefined }) {
  const actions = useActions();
  const now = useNow(1000);
  const live = liveLabel(props.live, now);
  const liveOn = props.live !== undefined && props.live.state !== 'off';
  const quota = quotaLabel(props.live);
  const unread = props.topics.reduce((total, item) => total + item.unreadTiles, 0);
  const counts = props.detail ? countPrs(props.detail.tiles) : null;
  const tools = toolsFooter(useTools().data);
  const lastSync = actions.lastSync;
  const mcp = useMcpConnection().data;
  const mcpShows = mcp !== undefined && mcpFooterShows(mcp);
  const left = withDividers([
    <span key="unread" className="flex items-center gap-1.5">
      <span className={`size-1.5 rounded-full ${unread > 0 ? 'bg-unread ring-2 ring-unread/16' : 'bg-dot-quiet'}`} />
      <span>
        <Num>{unread}</Num> unread
      </span>
    </span>,
    counts && (
      <span key="counts">
        <Num>{counts.pinged}</Num> pinged
        {counts.found > 0 && (
          <>
            {' · '}
            <Num>{counts.found}</Num> found
          </>
        )}
        {' · '}
        <Num>{counts.pulledIn}</Num> pulled in
      </span>
    ),
    <WritesLock key="lock" />,
    <button
      key="ping"
      type="button"
      onClick={() => void actions.sendTestNotification()}
      disabled={!window.postpile?.sendTestNotification}
      title={window.postpile?.sendTestNotification ? 'Send a test Mac notification' : 'Only in the desktop app'}
      className="text-muted hover:text-ink disabled:opacity-50 disabled:hover:text-muted"
    >
      test ping
    </button>,
    <span key="live" className={`flex items-center gap-[5px] ${live.warn ? 'text-amber-ink' : ''}`} title={live.title}>
      {liveOn && <span className={`size-[5px] rounded-full ring-2 ${live.warn ? 'bg-amber ring-amber/16' : 'bg-open ring-open/16'}`} />}
      {live.text}
    </span>,
    quota && (
      <span key="quota" className="text-amber-ink" title={quota.title}>
        {quota.text}
      </span>
    ),
    tools && (
      <span key="tools" className="text-amber-ink" title={tools.title}>
        {tools.text}
      </span>
    ),
    lastSync && (
      <span key="sync" title={syncReportDetail(lastSync)} className={lastSync.errors.length > 0 ? 'text-status-bad' : ''}>
        last sync: <Num>{lastSync.agentCallStats.total}</Num> {callStatsWords(lastSync.agentCallStats)}
        {lastSync.errors.length > 0 && ` · ${lastSync.errors.length} ${lastSync.errors.length === 1 ? 'error' : 'errors'}`}
      </span>
    ),
    // The item hides itself too; asked here as well so no divider is left dangling.
    mcpShows && <McpFooterItem key="mcp" />,
  ]);
  const right = withDividers([
    <span key="queue">{actions.pendingMarkReads > 0 ? `${actions.pendingMarkReads} mark-read in the undo window` : 'mark-read queue empty'}</span>,
    window.postpile?.version && (
      <span key="version" title="PostPile › About PostPile">
        v{window.postpile.version}
      </span>
    ),
  ]);
  return (
    <footer className="flex h-[26px] shrink-0 items-center gap-3 bg-titlebar px-3.5 font-mono text-[10.5px] whitespace-nowrap text-muted tabular-nums shadow-[inset_0_1px_0_var(--hairline-strong)]">
      {left}
      <span className="ml-auto" />
      {right}
    </footer>
  );
}

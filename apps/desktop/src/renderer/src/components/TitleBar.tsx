import { useActions } from '../api/actions.tsx';
import { capNote } from '../lib/agent-stats.ts';
import { ageLabel } from '../lib/time.ts';
import { useNow } from '../lib/use-now.ts';
import { LogoIcon, SyncIcon } from './icons.tsx';

function SyncStatus() {
  const actions = useActions();
  const now = useNow();
  const report = actions.lastSync;
  let dot = 'bg-dot-quiet';
  let text = 'not synced yet';
  if (actions.syncing) {
    dot = 'bg-accent';
    text = 'syncing…';
  } else if (report) {
    dot = report.errors.length > 0 ? 'bg-unread' : 'bg-open';
    const age = ageLabel(report.finishedAt, now);
    const when = age === 'now' ? 'just now' : `${age} ago`;
    text = `synced ${when} · ${report.prsFetched} PRs fetched · ${report.newEvents} new events`;
    const capped = capNote(report.agentCallStats);
    if (capped) {
      dot = 'bg-closer';
      text = `${text} · ${capped}`;
    }
  }
  return (
    <span className="ml-auto flex items-center gap-2 font-mono text-[11px] text-muted">
      <span className={`size-1.5 rounded-full ${dot}`} />
      {text}
    </span>
  );
}

/** 52px bar that drags the window. The left 88px stay free for the traffic lights. */
export function TitleBar() {
  const actions = useActions();
  return (
    <header className="drag-region flex h-[52px] shrink-0 items-center gap-3.5 border-b border-hairline-strong bg-titlebar pr-4 pl-[88px]">
      <span className="flex items-center gap-2">
        <LogoIcon />
        <span className="text-[13.5px] font-semibold tracking-[-0.01em]">Code Manager</span>
      </span>
      {actions.config?.fake && (
        <>
          <span className="h-[18px] w-px bg-frame" />
          <span
            className="flex h-[22px] items-center rounded-full border border-dashed border-frame px-2 text-[11px] text-muted"
            title="CODE_MANAGER_FAKE=1: built-in sample data, nothing reaches GitHub"
          >
            Sample data
          </span>
        </>
      )}
      <SyncStatus />
      <button
        type="button"
        aria-label="Sync now"
        title="Sync now"
        disabled={actions.syncing}
        onClick={() => void actions.sync()}
        className="flex h-7 w-[30px] items-center justify-center rounded-control border border-control bg-surface text-ink-2 shadow-control hover:bg-subtle disabled:opacity-60"
      >
        <SyncIcon className={actions.syncing ? 'animate-spin' : ''} />
      </button>
    </header>
  );
}

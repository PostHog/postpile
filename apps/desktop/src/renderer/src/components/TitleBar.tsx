import type { ReactNode } from 'react';
import { useActions } from '../api/actions.tsx';
import { capNote } from '../lib/agent-stats.ts';
import { syncReportDetail } from '../lib/sync-report.ts';
import { ageLabel } from '../lib/time.ts';
import { useNow } from '../lib/use-now.ts';
import logoUrl from '../assets/logo-64.png';
import { BackIcon, ForwardIcon, SyncIcon } from './icons.tsx';

function SyncStatus() {
  const actions = useActions();
  const now = useNow();
  const report = actions.lastSync;
  let dot = 'bg-dot-quiet';
  let text = 'not synced yet';
  let detail: string | null = null;
  if (actions.syncing) {
    dot = 'bg-accent';
    text = 'syncing…';
  } else if (report) {
    dot = report.errors.length > 0 ? 'bg-unread' : 'bg-open';
    const age = ageLabel(report.finishedAt, now);
    const when = age === 'now' ? 'just now' : `${age} ago`;
    text = `synced ${when} · ${report.prsFetched} PRs fetched · ${report.newEvents} new events`;
    detail = syncReportDetail(report);
    const capped = capNote(report.agentCallStats);
    if (capped) {
      dot = 'bg-closer';
      text = `${text} · ${capped}`;
    }
  }
  return (
    <span className="flex min-w-0 items-center gap-2 font-mono text-[11px] text-muted" title={detail ?? text}>
      <span className={`size-1.5 shrink-0 rounded-full ${dot}`} />
      <span className="truncate">{text}</span>
    </span>
  );
}

function NavButton(props: { label: string; shortcut: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={`${props.label} (${props.shortcut})`}
      disabled={props.disabled}
      onClick={props.onClick}
      className="flex size-7 items-center justify-center rounded-control text-ink-2 hover:bg-subtle disabled:text-ghost disabled:hover:bg-transparent"
    >
      {props.children}
    </button>
  );
}

interface TitleBarProps {
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  /** The search field, centered in the bar. */
  search: ReactNode;
  /** The repo filter, first in the right column (the left one clips popovers). */
  repoScope: ReactNode;
}

/**
 * 52px bar that drags the window. The left 88px (16px padding + 72px) stay
 * free for the traffic lights. Three columns, the outer two of equal width
 * and the padding symmetric, keep the search field centered on the window.
 */
export function TitleBar(props: TitleBarProps) {
  const actions = useActions();
  return (
    <header className="drag-region grid h-[52px] shrink-0 grid-cols-[minmax(0,1fr)_minmax(220px,380px)_minmax(0,1fr)] items-center gap-4 border-b border-hairline-strong bg-titlebar px-4">
      <div className="flex min-w-0 items-center gap-3.5 overflow-hidden pl-[72px] whitespace-nowrap">
        <span className="-ml-1.5 flex items-center">
          <NavButton label="Back" shortcut="⌘[" disabled={!props.canBack} onClick={props.onBack}>
            <BackIcon />
          </NavButton>
          <NavButton label="Forward" shortcut="⌘]" disabled={!props.canForward} onClick={props.onForward}>
            <ForwardIcon />
          </NavButton>
        </span>
        <span className="flex items-center gap-2">
          <img src={logoUrl} alt="" width={20} height={20} className="shrink-0" draggable={false} />
          {/* The name gives way below 1280px so the centered search keeps its width. */}
          <span className="text-[13.5px] font-semibold tracking-[-0.01em] max-xl:hidden">PostPile</span>
        </span>
        {actions.config?.profile === 'dev' && (
          <span
            className="flex h-[20px] shrink-0 items-center rounded-[5px] bg-ink px-1.5 font-mono text-[10px] font-semibold tracking-wide text-on-ink"
            title={`Dev profile: a separate database, not the real one.\n${actions.config.databasePath ?? 'sample data, no database'}`}
          >
            DEV
          </span>
        )}
        {actions.config?.fake && (
          <>
            <span className="h-[18px] w-px bg-frame" />
            <span
              className="flex h-[22px] shrink-0 items-center rounded-full border border-dashed border-frame px-2 text-[11px] text-muted"
              title="POSTPILE_FAKE=1: built-in sample data, nothing reaches GitHub"
            >
              Sample data
            </span>
          </>
        )}
      </div>
      {props.search}
      <div className="flex min-w-0 items-center justify-end gap-3.5">
        {props.repoScope}
        <SyncStatus />
        <button
          type="button"
          aria-label="Sync now"
          title="Sync now"
          disabled={actions.syncing}
          onClick={() => void actions.sync()}
          className="flex h-7 w-[30px] shrink-0 items-center justify-center rounded-control border border-control bg-surface text-ink-2 shadow-control hover:bg-subtle disabled:opacity-60"
        >
          <SyncIcon className={actions.syncing ? 'animate-spin' : ''} />
        </button>
      </div>
    </header>
  );
}
